import * as Crypto from "expo-crypto";
import { createAudioPlayer, requestRecordingPermissionsAsync } from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppState, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";

import AzurePronunciationStream from "../../modules/azure-pronunciation-stream/src";
import { createV2ApiClient, V2ApiError, classifyV2OutboxError } from "../../lib/v2-api-client.mjs";
import { createV2AttemptPipeline } from "../../lib/v2-attempt-pipeline.mjs";
import { createV2AudioRepository } from "../../lib/v2-audio-lifecycle.mjs";
import { createV2DeletionCoordinator } from "../../lib/v2-deletion.mjs";
import { createV2OutboxRepository, createV2OutboxWorker } from "../../lib/v2-outbox.mjs";
import { nextRestoredPosition, validateV2SessionShape } from "../../lib/v2-mobile-policy.mjs";
import { createV2TicketJournal } from "../../lib/v2-ticket-journal.mjs";
import { resolveV2ShellState } from "../../lib/v2-session-state.mjs";
import { normalizeManagedAzureResult } from "./normalizer-adapter";
import { openV2Database, protectedAudioStorage, protectedTicketStore } from "./local-storage";
import { V2PracticeShell, type V2LocalResult, type V2ManagedItem } from "./V2PracticeShell";

type OutboxPolicy = {
  retention_seconds: number;
  max_items: number;
  max_bytes: number;
  backoff_base_seconds: number;
  backoff_max_seconds: number;
};

type Bootstrap = {
  mode: "off" | "read_only" | "learning";
  contractVersion: string;
  normalizerVersion: string;
  contentVersion: string | null;
  deletionEpoch: number | null;
  outboxPolicy: OutboxPolicy | null;
  capabilities?: { liveLearningConfigured?: boolean };
};

type ManagedItem = V2ManagedItem & {
  slot_role?: string;
  prompt_role: string;
  practice_item_key: string;
  reference_text_version: string;
  target_locator: { wordIndex: number; phonemeIndex: number };
  next_action_key?: string | null;
  review_schedule_id?: string | null;
  review_source_evidence_id?: string | null;
  review_due_date?: string | null;
  review_interval_kind?: string | null;
  content_version_id: string;
  contract_version: string;
  dependency_command_id?: string | null;
  referenceAudio?: {standardUrl:string;slowUrl:string};
};

type Session = {
  id: string;
  content_version_id: string;
  focus_group_key: string;
  current_position: number;
  items: ManagedItem[];
  required_item_count?: number;
  optional_item_count?: number;
};

type ExperienceState =
  | { status: "loading" }
  | { status: "ready"; bootstrap: Bootstrap; readOnlyReason: string | null }
  | { status: "error"; reason: string };

type LocalResultWithCommand = V2LocalResult & { commandId: string };

export function V2Experience({ apiBaseUrl, getAccessToken, userId, online }: {
  apiBaseUrl: string;
  getAccessToken: () => Promise<string>;
  userId: string;
  online: boolean;
}) {
  const api = useMemo(
    () => createV2ApiClient({
      baseUrl: apiBaseUrl,
      getAccessToken,
      requestTimeoutMs: Number(process.env.EXPO_PUBLIC_V2_REQUEST_TIMEOUT_MS),
      validationHeaders: __DEV__ ? {
        "x-otokagami-installation-id": process.env.EXPO_PUBLIC_VALIDATION_INSTALLATION_ID ?? "",
        "x-otokagami-development-client": process.env.EXPO_PUBLIC_VALIDATION_DEVELOPMENT_CLIENT_MARKER ?? ""
      } : {}
    }),
    [apiBaseUrl, getAccessToken]
  );
  const [state, setState] = useState<ExperienceState>({ status: "loading" });
  const [tab, setTab] = useState<"home" | "practice" | "settings">("home");
  const [session, setSession] = useState<Session | null>(null);
  const [localIndex, setLocalIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [recordingState, setRecordingState] = useState("ready");
  const [attemptPurpose, setAttemptPurpose] = useState<"initial" | "guided_retry">("initial");
  const [results, setResults] = useState<Record<string, LocalResultWithCommand>>({});
  const [comparisons, setComparisons] = useState<Record<string, {
    before: V2LocalResult | null;
    after: V2LocalResult | null;
  }>>({});
  const [settingsBusy, setSettingsBusy] = useState(false);
  const databaseRef = useRef<any>(null);
  const outboxRef = useRef<any>(null);
  const audioRef = useRef<any>(null);
  const workerRef = useRef<any>(null);
  const pipelineRef = useRef<any>(null);
  const ticketJournalRef=useRef<any>(null);
  const deletionRef = useRef<any>(null);
  const bootstrapRef = useRef<Bootstrap | null>(null);
  const lastDurableCommandRef = useRef<string | null>(null);
  const pendingAudioRef = useRef(new Map<string, { fileKey: string; itemId: string; localCycleId: string }>());
  const playerRef=useRef<ReturnType<typeof createAudioPlayer>|null>(null);

  const playUri=useCallback((uri:string|null|undefined)=>{
    if(!uri){setNotice("音声を再生できませんでした。");return;}
    playerRef.current?.remove();
    let resolved=uri;
    try{resolved=new URL(uri,`${apiBaseUrl.replace(/\/$/,"")}/`).toString();}
    catch{setNotice("音声を再生できませんでした。");return;}
    const player=createAudioPlayer(resolved);playerRef.current=player;player.play();
  },[apiBaseUrl]);
  useEffect(()=>()=>{playerRef.current?.remove();},[]);

  const ensureDatabase = useCallback(async () => {
    if (databaseRef.current) return databaseRef.current;
    const database = await openV2Database(userId);
    databaseRef.current = database;
    outboxRef.current = createV2OutboxRepository(database);
    audioRef.current = createV2AudioRepository({
      database,
      protectedStorage: protectedAudioStorage,
      clock: localClock
    });
    ticketJournalRef.current=createV2TicketJournal(database,localClock);
    await ticketJournalRef.current.cleanupExpired(protectedTicketStore);
    await outboxRef.current.recoverExpiredLeases(localClock.now());
    await audioRef.current.sweep();
    return database;
  }, [userId]);

  const drainOutbox = useCallback(async () => {
    if (!online || !workerRef.current) return;
    for (let index = 0; index < 20; index += 1) {
      const result = await workerRef.current.runOnce();
      if (result.status === "idle" || result.status === "busy" || result.status === "retryable") break;
    }
  }, [online]);

  const configureRuntime = useCallback(async (bootstrap: Bootstrap) => {
    const database = await ensureDatabase();
    if (!bootstrap.outboxPolicy || bootstrap.deletionEpoch === null) return;
    const previousEpoch = await database.getFirstAsync(
      "SELECT deletion_epoch FROM v2_local_snapshots WHERE user_id = ?", userId
    );
    if (previousEpoch && Number(previousEpoch.deletion_epoch) < bootstrap.deletionEpoch) {
      await outboxRef.current.purgeBeforeEpoch(userId, bootstrap.deletionEpoch);
      await audioRef.current.deleteAllForUser(userId);
    }
    const config = mapOutboxPolicy(bootstrap.outboxPolicy);
    outboxRef.current.setLimits(config);
    const workerApi = {
      classify: classifyV2OutboxError,
      resourceId(command: any, response: any) {
        if (command.command_kind === "attempt") return response?.attempt_id ?? null;
        if (command.command_kind === "review_completion") return response?.review_schedule_id ?? null;
        return response?.session_id ?? command.session_id ?? null;
      },
      async send(command: any, ticketNonce: string | null) {
        if (command.command_kind === "attempt") {
          if (!ticketNonce) throw new V2ApiError("ASSESSMENT_TICKET_REQUIRED", "判定情報が失効しました。", 409, false);
          return api.persistAttempt({
            session_item_id: command.session_item_id,
            client_attempt_id: command.client_attempt_id,
            assessment_ticket_id: command.assessment_ticket_id,
            ticket_request_id: command.ticket_request_id,
            assessment_ticket_nonce: ticketNonce,
            deletion_epoch: command.deletion_epoch,
            recording_started_at: command.recording_started_at,
            captured_at: command.captured_at,
            provider_result_received_at: command.provider_result_received_at,
            provider_projection: JSON.parse(command.strict_projection_json)
          });
        }
        const payload = JSON.parse(command.control_payload_json ?? "{}");
        if (command.command_kind === "review_completion") {
          if (!command.dependency_server_resource_id) {
            throw new V2ApiError("DEPENDENCY_NOT_CONFIRMED", "復習結果を確認できません。", 409, true);
          }
          return api.completeReview({ ...payload, attempt_id: command.dependency_server_resource_id });
        }
        return api.completeSession(command.session_id, payload.completion_idempotency_key);
      }
    };
    workerRef.current = createV2OutboxWorker({
      userId,
      repository: outboxRef.current,
      api: workerApi,
      protectedMaterialStore: protectedTicketStore,
      clock: localClock,
      config,
      async onConfirmed(command: any, response: any) {
        if (command.command_kind === "attempt") {
          setResults((current) => {
            const found = Object.entries(current).find(([, result]) => result.commandId === command.command_id);
            if (!found) return current;
            return { ...current, [found[0]]: { ...found[1], syncState: "confirmed" } };
          });
          const pending = pendingAudioRef.current.get(command.command_id);
          if (pending && typeof response?.correction_cycle_id === "string") {
            await audioRef.current.bindCorrectionCycle(pending.localCycleId, response.correction_cycle_id);
          }
          pendingAudioRef.current.delete(command.command_id);
        } else if (command.command_kind === "session_completion") {
          setSession(null);
          setResults({});
          setComparisons({});
          setNotice("今日の学習を保存しました。");
        }
      },
      async onPermanentFailure(command: any) {
        if (command.command_kind !== "attempt") return;
        setResults((current) => {
          const found = Object.entries(current).find(([, result]) => result.commandId === command.command_id);
          if (!found) return current;
          return { ...current, [found[0]]: { ...found[1], syncState: "permanent_failure" } };
        });
        const pending = pendingAudioRef.current.get(command.command_id);
        if (pending) {
          await protectedAudioStorage.deleteAudio(pending.fileKey).catch(() => undefined);
          pendingAudioRef.current.delete(command.command_id);
        }
      }
    });
    pipelineRef.current = createV2AttemptPipeline({
      api,
      native: {
        prepare: (options: any) => AzurePronunciationStream.prepare(options),
        start: (requestId: string) => AzurePronunciationStream.start(requestId),
        finish: (requestId: string) => AzurePronunciationStream.finish(requestId),
        cancel: (requestId: string) => AzurePronunciationStream.cancel(requestId),
        deleteTemporary: protectedAudioStorage.deleteTemporary
      },
      normalizer: normalizeManagedAzureResult,
      outbox: outboxRef.current,
      ticketJournal:ticketJournalRef.current,
      protectedTicketStore,
      ids: {
        materialHandle: () => Crypto.randomUUID(),
        requestId: () => Crypto.randomUUID(),
        commandId: () => Crypto.randomUUID(),
        clientAttemptId: () => Crypto.randomUUID()
        ,ticketRequestId:()=>Crypto.randomUUID()
        ,ticketNonce:()=>Crypto.randomUUID()
      },
      clock: localClock,
      triggerSync: drainOutbox
    });
    deletionRef.current = createV2DeletionCoordinator({
      database,
      outbox: outboxRef.current,
      audio: audioRef.current,
      api,
      clock: localClock,
      protectedMaterialStore: protectedTicketStore
    });
    const resumedDeletion = await deletionRef.current.resume(userId);
    if (resumedDeletion?.deletionEpoch !== undefined) bootstrap.deletionEpoch = resumedDeletion.deletionEpoch;
    // Keep the current epoch alongside an offline-safe, non-sensitive snapshot.
    await database.runAsync(
      `INSERT INTO v2_local_snapshots (user_id, deletion_epoch, contract_version, snapshot_json, updated_at)
       VALUES (?, ?, ?, '{}', ?)
       ON CONFLICT(user_id) DO UPDATE SET deletion_epoch=excluded.deletion_epoch,
         contract_version=excluded.contract_version, updated_at=excluded.updated_at`,
      userId, bootstrap.deletionEpoch, bootstrap.contractVersion, localClock.now()
    );
  }, [api, drainOutbox, ensureDatabase, userId]);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const database = await ensureDatabase();
      if (!online) {
        const snapshot = await database.getFirstAsync(
          "SELECT snapshot_json FROM v2_local_snapshots WHERE user_id = ?", userId
        );
        if (snapshot?.snapshot_json && snapshot.snapshot_json !== "{}") {
          const cached=JSON.parse(snapshot.snapshot_json);
          setSession(cached);
          const rows=await outboxRef.current.listUserResults(userId);
          const restored=Object.fromEntries(rows.map((row:any)=>[row.session_item_id,{
            expectedFocus:row.expected_focus,observedCandidate:row.observed_candidate,
            resultLabel:row.result_label,nextActionKey:row.next_action_key,
            syncState:row.sync_state,commandId:row.command_id
          }]));
          setResults(restored);
          setLocalIndex(nextRestoredPosition(cached,restored));
          setTab("practice");
          setState({ status: "error", reason: "OFFLINE_SNAPSHOT" });
        } else {
          setState({ status: "error", reason: "OFFLINE_NO_SNAPSHOT" });
        }
        return;
      }
      const bootstrap = await api.bootstrap() as Bootstrap;
      bootstrapRef.current = bootstrap;
      const liveConfigReady = Boolean(bootstrap.outboxPolicy && bootstrap.capabilities?.liveLearningConfigured);
      const shell = resolveV2ShellState({
        mode: bootstrap.mode,
        contentVersion: bootstrap.contentVersion,
        online,
        hasSnapshot: false,
        liveConfigReady
      });
      if (liveConfigReady) await configureRuntime(bootstrap);
      setState({ status: "ready", bootstrap, readOnlyReason: shell.kind === "read_only" ? shell.reason : null });
      if (shell.kind === "learning") void drainOutbox();
    } catch (error) {
      const reason = error instanceof V2ApiError ? error.code : "NETWORK_UNAVAILABLE";
      setState({ status: "error", reason });
    }
  }, [api, configureRuntime, drainOutbox, ensureDatabase, online, userId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (online) void drainOutbox();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && online) void drainOutbox();
      if(next!=="active"&&pipelineRef.current?.active){
        void pipelineRef.current.cancel();setRecordingState("ready");
        setNotice("バックグラウンドへ移動したため録音を停止しました。");
      }
    });
    return () => subscription.remove();
  }, [drainOutbox, online]);
  useEffect(()=>{
    if(!online&&pipelineRef.current?.active){
      void pipelineRef.current.cancel();setRecordingState("ready");
      setNotice("通信が切れたため録音を停止しました。");
    }
  },[online]);

  const startSession = useCallback(async () => {
    if (state.status !== "ready" || state.readOnlyReason) return;
    try {
      const result = await api.dailySession(currentTimezone()) as { contract_version: string; session: Omit<Session, "items"> & { items: Array<Omit<ManagedItem, "content_version_id" | "contract_version">> } };
      let currentBootstrap = bootstrapRef.current;
      if (!currentBootstrap || currentBootstrap.deletionEpoch === null) {
        currentBootstrap = await api.bootstrap() as Bootstrap;
        bootstrapRef.current = currentBootstrap;
        await configureRuntime(currentBootstrap);
      }
      const nextSession: Session = {
        ...result.session,
        items: result.session.items.map((item) => ({
          ...item,
          content_version_id: result.session.content_version_id,
          contract_version: result.contract_version
        }))
      };
      validateV2SessionShape(nextSession);
      setSession(nextSession);
      setLocalIndex(Math.max(0, (nextSession.current_position ?? 1) - 1));
      const restoredRows=await outboxRef.current.listUserResults(userId);
      const restored=Object.fromEntries(restoredRows.map((row:any)=>[row.session_item_id,{
        expectedFocus:row.expected_focus,observedCandidate:row.observed_candidate,resultLabel:row.result_label,
        nextActionKey:row.next_action_key,syncState:row.sync_state,commandId:row.command_id
      }]));
      setResults(restored);
      setLocalIndex(nextRestoredPosition(nextSession,restored));
      setTab("practice");
      setNotice(null);
      await databaseRef.current.runAsync(
        "UPDATE v2_local_snapshots SET snapshot_json = ?, updated_at = ? WHERE user_id = ?",
        JSON.stringify(nextSession), localClock.now(), userId
      );
    } catch (error) {
      const code = error instanceof V2ApiError ? error.code : "NETWORK_UNAVAILABLE";
      setNotice(code === "CONTENT_NOT_READY" ? "今日の教材は準備中です。" : "課題を取得できませんでした。");
    }
  }, [api, configureRuntime, state, userId]);

  const item = session?.items[localIndex] ?? null;
  const localResult = item ? results[item.id] ?? null : null;

  const startRecording = useCallback(async (purpose: "initial" | "guided_retry" = "initial") => {
    if (!item || !pipelineRef.current || state.status !== "ready" || state.readOnlyReason) return;
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setNotice("マイクの許可が必要です。");
      return;
    }
    try {
      setRecordingState("preparing");
      setAttemptPurpose(purpose);
      if (purpose === "guided_retry" && localResult?.syncState !== "confirmed") {
        setNotice("最初の判定を保存後に再挑戦できます。");
        setRecordingState("ready");
        return;
      }
      const valid=await outboxRef.current.countValidAttempts(userId,item.id);
      if(Number(valid?.count??0)>=3){setNotice("この課題の有効な判定は3回までです。");setRecordingState("ready");return;}
      await pipelineRef.current.start({
        item: {
          ...item,
          dependency_command_id: purpose === "guided_retry"
            ? localResult?.commandId ?? null
            : lastDurableCommandRef.current
        },
        purpose,userId
      });
      setRecordingState("recording");
    } catch (error) {
      setRecordingState("ready");
      setNotice(error instanceof V2ApiError ? error.message : "録音を開始できませんでした。");
    }
  }, [item, localResult, state]);

  const stopRecording = useCallback(async () => {
    if (!item || !session || !pipelineRef.current || !bootstrapRef.current) return;
    try {
      setRecordingState("normalizing");
      const completed = await pipelineRef.current.finish({
        userId,
        sessionId: session.id,
        deletionEpoch: bootstrapRef.current.deletionEpoch,
        async onLocalResult(result: LocalResultWithCommand & { localAudioSource?: string; technicalValid?: boolean }) {
          setResults((current) => ({ ...current, [item.id]: result }));
          setComparisons((current) => {
            const previous = current[item.id] ?? { before: null, after: null };
            return {
              ...current,
              [item.id]: attemptPurpose === "guided_retry"
                ? { ...previous, after: result }
                : { before: result, after: null }
            };
          });
          if (result.localAudioSource) {
            if (result.technicalValid && item.prompt_role === "anchor") {
              const fileKey = `${Crypto.randomUUID()}.wav`;
              await audioRef.current.selectRepresentative({
                sourceUri: result.localAudioSource,
                fileKey,
                userId,
                correctionCycleId: `${session.id}:${item.id}`,
                contentVersionId: item.content_version_id,
                attemptRole: attemptPurpose === "guided_retry" ? "after" : "before"
              });
              pendingAudioRef.current.set(result.commandId, {
                fileKey,
                itemId: item.id,
                localCycleId: `${session.id}:${item.id}`
              });
            } else {
              await audioRef.current.discardTemporary(result.localAudioSource);
            }
          }
        }
      });
      let durableDependency = completed.commandId;
      if (item.prompt_role === "review" && item.review_schedule_id) {
        const reviewCommandId = Crypto.randomUUID();
        await outboxRef.current.enqueueControl(controlCommand({
          bootstrap: bootstrapRef.current,
          session,
          item,
          commandId: reviewCommandId,
          commandKind: "review_completion",
          dependencyCommandId: completed.commandId,
          submissionExpiresAt: completed.submissionExpiresAt,
          payload: {
            review_schedule_id: item.review_schedule_id,
            session_item_id: item.id,
            deletion_epoch: bootstrapRef.current.deletionEpoch,
            completion_idempotency_key: Crypto.randomUUID()
          },
          userId
        }));
        durableDependency = reviewCommandId;
      }
      lastDurableCommandRef.current = durableDependency;
      setRecordingState("ready");
      void drainOutbox();
    } catch (error) {
      setRecordingState("ready");
      setNotice(error instanceof V2ApiError ? error.message : "判定結果を確認できませんでした。");
    }
  }, [attemptPurpose, drainOutbox, item, session, userId]);

  const nextItem = useCallback(async () => {
    if (!session || !item || !localResult || localResult.syncState === "permanent_failure") return;
    if (localIndex < session.items.length - 1) {
      setLocalIndex((current) => current + 1);
      setAttemptPurpose("initial");
      return;
    }
    const bootstrap = bootstrapRef.current;
    if (!bootstrap?.outboxPolicy || bootstrap.deletionEpoch === null || !lastDurableCommandRef.current) return;
    const commandId = Crypto.randomUUID();
    await outboxRef.current.enqueueControl(controlCommand({
      bootstrap,
      session,
      item,
      commandId,
      commandKind: "session_completion",
      dependencyCommandId: lastDurableCommandRef.current,
      submissionExpiresAt: addSeconds(localClock.now(), bootstrap.outboxPolicy.retention_seconds),
      payload: { completion_idempotency_key: Crypto.randomUUID() },
      userId
    }));
    setNotice("結果は端末に保存されました。サーバー確認後に今日の完了が確定します。");
    setTab("home");
    void drainOutbox();
  }, [drainOutbox, item, localIndex, localResult, session, userId]);

  const exportLearningData = useCallback(async () => {
    setSettingsBusy(true);
    let uri:string|null=null;
    try {
      const exported = await api.exportLearningData();
      uri = `${FileSystem.cacheDirectory}otokagami-learning-export-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(exported), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json" });
      setNotice("学習データの書き出しを準備しました。");
    } catch {
      setNotice("学習データを書き出せませんでした。");
    } finally {
      if(uri) await FileSystem.deleteAsync(uri,{idempotent:true}).catch(()=>undefined);
      setSettingsBusy(false);
    }
  }, [api]);

  const requestLearningDeletion = useCallback(() => {
    const bootstrap = bootstrapRef.current;
    if (!deletionRef.current || bootstrap?.deletionEpoch === null || bootstrap?.deletionEpoch === undefined) return;
    Alert.alert("学習データを削除", "購読権限と無料体験の利用履歴は保持されます。学習履歴を削除しますか？", [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除", style: "destructive", onPress: () => void (async () => {
          setSettingsBusy(true);
          try {
            await pipelineRef.current?.cancel();
            await deletionRef.current.begin({ requestId: Crypto.randomUUID(), userId, localEpoch: bootstrap.deletionEpoch });
            const result = await deletionRef.current.resume(userId);
            if (result?.deletionEpoch !== undefined) bootstrap.deletionEpoch = result.deletionEpoch;
            setSession(null);
            setResults({});
            setComparisons({});
            setNotice("学習データを削除しました。無料体験の利用履歴と購読状態は保持されています。");
            setTab("home");
          } catch {
            setNotice("削除処理は安全に保留されています。次回起動時に同じ要求を再開します。");
          } finally {
            setSettingsBusy(false);
          }
        })()
      }
    ]);
  }, [userId]);

  const readOnlyReason = state.status === "ready"
    ? state.readOnlyReason
    : state.status === "error"
      ? state.reason
      : "LOADING";

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        {tab === "home" ? (
          <View style={styles.page}>
            <Text style={styles.brand}>Otokagami</Text>
            <Text accessibilityRole="header" style={styles.title}>今日の1音</Text>
            <Text style={styles.copy}>1つの音を見つけ、短いコツと再挑戦で変化を確かめます。</Text>
            {notice ? <Text style={styles.notice}>{notice}</Text> : null}
            <Pressable
              accessibilityHint="今日の管理課題を開始または再開します"
              accessibilityLabel="今日の練習を始める"
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(readOnlyReason) }}
              disabled={Boolean(readOnlyReason)}
              onPress={() => void startSession()}
              style={[styles.start, readOnlyReason ? styles.disabled : null]}
            >
              <Text style={styles.startText}>今日の練習を始める</Text>
            </Pressable>
            {readOnlyReason ? <ReadOnlyNotice reason={readOnlyReason} onRetry={() => void load()} /> : null}
          </View>
        ) : tab === "practice" ? (
          <V2PracticeShell
            item={item}
            currentIndex={localIndex}
            totalItems={session?.items.length ?? 0}
            state={recordingState}
            localResult={localResult}
            comparison={item ? comparisons[item.id] ?? null : null}
            coachText={localResult && item?.next_action_key && item.prompt_role === "anchor"
              ? "焦点音の位置を意識し、同じ速さでもう一度発音します。"
              : null}
            guidedRetryAvailable={item?.prompt_role === "anchor" && localResult?.syncState === "confirmed" && attemptPurpose !== "guided_retry"}
            readOnlyReason={readOnlyReason}
            onPlayReference={() => playUri(item?.referenceAudio?.standardUrl)}
            onStartRecording={() => void startRecording("initial")}
            onStopRecording={() => void stopRecording()}
            onGuidedRetry={() => void startRecording("guided_retry")}
            onPlayBefore={()=>void audioRef.current.resolveRepresentative(`${session?.id}:${item?.id}`,"before").then(playUri)}
            onPlayAfter={()=>void audioRef.current.resolveRepresentative(`${session?.id}:${item?.id}`,"after").then(playUri)}
            onNext={() => void nextItem()}
          />
        ) : (
          <View style={styles.page}>
            <Text accessibilityRole="header" style={styles.title}>設定</Text>
            <Text style={styles.copy}>購入復元、データ書き出し・削除、規約は既存のアプリIDとユーザーIDを維持して移行します。</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="学習データを書き出す" disabled={settingsBusy}
              onPress={() => void exportLearningData()} style={[styles.retry, settingsBusy ? styles.disabled : null]}>
              <Text style={styles.retryText}>学習データを書き出す</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="学習データを削除する" disabled={settingsBusy}
              onPress={requestLearningDeletion} style={[styles.retry, settingsBusy ? styles.disabled : null]}>
              <Text style={styles.deleteText}>学習データを削除する</Text>
            </Pressable>
            <Text style={styles.notice}>削除中は録音と同期を停止し、同じ削除要求を安全に再開します。</Text>
          </View>
        )}
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {(["home", "practice", "settings"] as const).map((key) => (
          <Pressable key={key} accessibilityLabel={key === "home" ? "ホーム" : key === "practice" ? "練習" : "設定"}
            accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)}
            style={[styles.tab, tab === key ? styles.selected : null]}>
            <Text style={tab === key ? styles.selectedText : styles.tabText}>
              {key === "home" ? "ホーム" : key === "practice" ? "練習" : "設定"}
            </Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}

function controlCommand({ bootstrap, session, item, commandId, commandKind, dependencyCommandId, submissionExpiresAt, payload, userId }: any) {
  return {
    commandId, commandKind, userId, sessionId: session.id, sessionItemId: item.id,
    contentVersionId: session.content_version_id, focusGroupKey: session.focus_group_key,
    assessmentLocale: "en-US", deletionEpoch: bootstrap.deletionEpoch,
    referenceVersion: item.reference_text_version, normalizerVersion: bootstrap.normalizerVersion,
    projectionVersion: "control-v1", contractVersion: bootstrap.contractVersion,
    submissionExpiresAt, dependencyCommandId, controlPayload: payload, createdAt: localClock.now()
  };
}

function mapOutboxPolicy(policy: OutboxPolicy) {
  return {
    maxItems: policy.max_items,
    maxBytes: policy.max_bytes,
    submissionWindowSeconds: policy.retention_seconds,
    initialBackoffSeconds: policy.backoff_base_seconds,
    maxBackoffSeconds: policy.backoff_max_seconds
  };
}

const localClock = Object.freeze({
  now: () => new Date().toISOString(),
  id: () => Crypto.randomUUID(),
  addSeconds: (instant: string, seconds: number) => addSeconds(instant, seconds),
  addDays: (instant: string, days: number) => addSeconds(instant, days * 86_400)
});

function addSeconds(instant: string, seconds: number) {
  return new Date(Date.parse(instant) + seconds * 1_000).toISOString();
}

function ReadOnlyNotice({ reason, onRetry }: { reason: string; onRetry: () => void }) {
  const message = reason === "CONTENT_NOT_READY"
    ? "今日の教材は準備中です。旧7問へは切り替えません。"
    : reason.startsWith("OFFLINE") || reason === "NETWORK_UNAVAILABLE"
      ? "オフラインでは保存済み情報だけを表示します。新しい判定は行いません。"
      : "新しい学習体験を安全に準備しています。";
  return <View style={styles.readOnly} accessibilityLiveRegion="polite"><Text style={styles.copy}>{message}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="状態を再確認" onPress={onRetry} style={styles.retry}>
      <Text style={styles.retryText}>再確認</Text>
    </Pressable></View>;
}

function currentTimezone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }
  catch { return "UTC"; }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f6f7f4" }, body: { flex: 1 }, page: { flex: 1, gap: 18, padding: 24 },
  brand: { color: "#0c6b58", fontSize: 17, fontWeight: "900" }, title: { color: "#14212b", fontSize: 30, fontWeight: "900" },
  copy: { color: "#52616f", fontSize: 17, lineHeight: 25 }, notice: { color: "#6c4608", backgroundColor: "#fff0d7", padding: 14, borderRadius: 8, fontSize: 15, lineHeight: 22 },
  start: { alignItems: "center", justifyContent: "center", minHeight: 56, backgroundColor: "#0c6b58", borderRadius: 10 },
  startText: { color: "#fff", fontSize: 18, fontWeight: "900" }, disabled: { opacity: 0.45 }, readOnly: { gap: 12, backgroundColor: "#fff", borderRadius: 9, padding: 16 },
  retry: { alignItems: "center", justifyContent: "center", minHeight: 48, borderColor: "#0c6b58", borderWidth: 1, borderRadius: 8 }, retryText: { color: "#0c6b58", fontWeight: "900", fontSize: 16 },
  deleteText: { color: "#a22c2c", fontWeight: "900", fontSize: 16 },
  tabs: { flexDirection: "row", borderTopColor: "#d9e2df", borderTopWidth: 1, backgroundColor: "#fff", padding: 8 },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 50, borderRadius: 8 }, selected: { backgroundColor: "#e6f3ef" },
  tabText: { color: "#657481", fontSize: 14, fontWeight: "800" }, selectedText: { color: "#0c6b58", fontSize: 14, fontWeight: "900" }
});
