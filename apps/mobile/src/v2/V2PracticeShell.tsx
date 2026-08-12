import React from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export type V2ManagedItem = {
  id: string;
  position: number;
  reference_text: string;
  expected_focus_representation: string;
  focus_group_key: string;
  status: string;
  required?: boolean;
};

export type V2LocalResult = {
  expectedFocus: string;
  observedCandidate: string | null;
  resultLabel: string;
  nextActionKey: string | null;
  syncState: "pending" | "confirmed" | "permanent_failure";
  technicalValid?: boolean;
};

export function V2PracticeShell({
  item,
  currentIndex,
  totalItems,
  state,
  localResult,
  comparison,
  coachText,
  readOnlyReason,
  onPlayReference,
  onPlayReferenceSlow,
  onStartRecording,
  onStopRecording,
  onGuidedRetry,
  onPlayBefore,
  onPlayAfter,
  guidedRetryAvailable = false,
  remainingValidAttempts = 3,
  completionAvailable = false,
  additionalPracticeAvailable = false,
  onCompleteDay,
  onAdditionalPractice,
  onNext
}: {
  item: V2ManagedItem | null;
  currentIndex: number;
  totalItems: number;
  state: string;
  localResult: V2LocalResult | null;
  comparison?: { before: V2LocalResult | null; after: V2LocalResult | null } | null;
  coachText?: string | null;
  readOnlyReason?: string | null;
  onPlayReference: () => void;
  onPlayReferenceSlow?: () => void;
  onStartRecording: () => void;
  onStopRecording: () => void;
  onGuidedRetry: () => void;
  onPlayBefore?:()=>void;
  onPlayAfter?:()=>void;
  guidedRetryAvailable?: boolean;
  remainingValidAttempts?: number;
  completionAvailable?: boolean;
  additionalPracticeAvailable?: boolean;
  onCompleteDay?: () => void;
  onAdditionalPractice?: () => void;
  onNext: () => void;
}) {
  if (readOnlyReason && !item) {
    return (
      <View style={styles.screen} accessibilityRole="summary">
        <Text style={styles.title}>Otokagami</Text>
        <Text style={styles.statusTitle}>学習の準備中です</Text>
        <Text style={styles.body}>{readOnlyMessage(readOnlyReason)}</Text>
        <Text style={styles.body}>保存済みの結果やレポートは引き続き閲覧できます。</Text>
      </View>
    );
  }
  if (!item) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator accessibilityLabel="今日の課題を準備中" color="#0c6b58" />
        <Text style={styles.body}>今日の課題を準備しています。</Text>
      </View>
    );
  }
  const busy = ["preparing", "normalizing"].includes(state);
  const recording = state === "recording";
  const canAdvance = localResult?.technicalValid === true &&
    (localResult.syncState === "pending" || localResult.syncState === "confirmed");
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.screen}>
      <Text style={styles.kicker}>今日の音 /{item.expected_focus_representation}/</Text>
      <Text style={styles.counter}>{currentIndex + 1} / {totalItems}</Text>
      <Text accessibilityRole="header" style={styles.prompt}>{item.reference_text}</Text>
      <Text style={styles.focus}>焦点音 /{item.expected_focus_representation}/</Text>
      {readOnlyReason ? <Text style={styles.readOnlyBanner}>オフライン表示です。録音や学習状態の確定はできません。</Text> : null}
      <ActionButton
        label="標準のお手本を聞く"
        hint="この課題の標準音声を再生します"
        onPress={onPlayReference}
        secondary
      />
      <ActionButton label="ゆっくりのお手本を聞く" hint="この課題のゆっくりした音声を再生します"
        onPress={onPlayReferenceSlow??onPlayReference} secondary />
      {recording ? (
        <ActionButton label="停止して判定" hint="録音を停止して対象音を確認します" onPress={onStopRecording} />
      ) : (
        <ActionButton
          label={localResult ? "もう一度録音" : "録音する"}
          hint="マイクで管理課題の発音を録音します"
          onPress={onStartRecording}
          disabled={busy || Boolean(readOnlyReason)}
        />
      )}
      {busy ? (
        <View style={styles.statusPanel} accessibilityLiveRegion="polite">
          <ActivityIndicator color="#0c6b58" />
          <Text style={styles.body}>{state === "normalizing" ? "対象音を確認しています。" : "録音を準備しています。"}</Text>
        </View>
      ) : null}
      {localResult ? (
        <View style={styles.resultPanel} accessibilityLiveRegion="polite">
          <Text style={styles.resultTitle}>対象音 /{localResult.expectedFocus}/</Text>
          <Text style={styles.body}>
            {localResult.observedCandidate ? `近く聞こえた音: /${localResult.observedCandidate}/` : "音の候補は取得できませんでした。"}
          </Text>
          <Text style={styles.actionText}>
            {localResult.nextActionKey
              ? "表示された焦点音を意識して、もう一度試しましょう。"
              : "同じ音を意識して、もう一度試しましょう。"}
          </Text>
          <Text style={styles.syncText}>
            {localResult.syncState === "confirmed"
              ? "保存済み"
              : localResult.syncState === "permanent_failure"
                ? "保存できませんでした。結果は端末で確認できます。"
                : "端末に保存済み・同期待ち"}
          </Text>
          <Text style={styles.syncText}>有効な判定の残り: {remainingValidAttempts}回</Text>
          {!localResult.technicalValid ? (
            <Text style={styles.readOnlyBanner}>録音を確認できませんでした。この結果では次へ進まず、再試行できます。</Text>
          ) : null}
          {comparison?.before && comparison.after ? (
            <View style={styles.comparison} accessibilityLabel="修正前と再挑戦の比較">
              <Text style={styles.comparisonTitle}>修正前と再挑戦</Text>
              <Text style={styles.body}>
                修正前: {candidateLabel(comparison.before)}　→　再挑戦: {candidateLabel(comparison.after)}
              </Text>
              <Text style={styles.syncText}>変化の判定は、サーバー確認後の学習状態とは分けて扱います。</Text>
              <ActionButton label="修正前を聞く" hint="端末に保存した代表録音を再生します" onPress={onPlayBefore??(()=>undefined)} secondary />
              <ActionButton label="再挑戦を聞く" hint="端末に保存した代表録音を再生します" onPress={onPlayAfter??(()=>undefined)} secondary />
            </View>
          ) : null}
          {coachText ? <Text style={styles.coach}>{coachText}</Text> : null}
          {coachText ? (
            <ActionButton label="コツを意識して再挑戦" hint={guidedRetryAvailable
              ? "同じ課題をコーチ付きで録音します"
              : "最初の判定の同期後に再挑戦できます"}
              onPress={onGuidedRetry} disabled={!guidedRetryAvailable} secondary />
          ) : null}
          {completionAvailable ? (
            <ActionButton label="今日を完了" hint="必須課題だけで今日の完了確認を送ります"
              onPress={onCompleteDay??(()=>undefined)} disabled={!canAdvance} />
          ) : null}
          {additionalPracticeAvailable ? (
            <ActionButton label="追加練習へ" hint="任意の追加課題へ進みます"
              onPress={onAdditionalPractice??(()=>undefined)} disabled={!canAdvance} secondary />
          ) : null}
          {!completionAvailable ? (
            <ActionButton
              label="次の課題へ"
              hint={canAdvance ? "端末に保存した結果を保ったまま次の管理課題へ進みます" : "有効な結果を確認後に次へ進めます"}
              onPress={onNext}
              disabled={!canAdvance}
            />
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

function candidateLabel(result: V2LocalResult) {
  return result.observedCandidate ? `/${result.observedCandidate}/` : "候補なし";
}

function ActionButton({ label, hint, onPress, disabled = false, secondary = false }: {
  label: string;
  hint: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityHint={hint}
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      style={[styles.button, secondary ? styles.secondary : styles.primary, disabled ? styles.disabled : null]}
    >
      <Text style={[styles.buttonText, secondary ? styles.secondaryText : null]}>{label}</Text>
    </Pressable>
  );
}

function readOnlyMessage(reason: string) {
  if (reason === "CONTENT_NOT_READY") return "今日の教材は現在準備中です。";
  if (reason.startsWith("OFFLINE")) return "オフラインのため、新しい判定は開始できません。";
  if (reason === "LIVE_CONFIG_NOT_READY") return "安全な同期設定を確認しています。";
  return "新しい学習体験を準備しています。";
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#f6f7f4" },
  screen: { flex: 1, gap: 16, padding: 22, backgroundColor: "#f6f7f4" },
  title: { color: "#0c6b58", fontSize: 17, fontWeight: "900" },
  statusTitle: { color: "#14212b", fontSize: 28, fontWeight: "900" },
  kicker: { color: "#0c6b58", fontSize: 16, fontWeight: "900" },
  counter: { color: "#61717f", fontSize: 15, fontWeight: "700" },
  prompt: { color: "#14212b", fontSize: 30, fontWeight: "900", lineHeight: 39 },
  focus: { color: "#435463", fontSize: 20, fontWeight: "800" },
  body: { color: "#52616f", fontSize: 17, lineHeight: 25 },
  statusPanel: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: "#fff", padding: 16, borderRadius: 10 },
  resultPanel: { gap: 12, backgroundColor: "#fff", borderRadius: 10, borderWidth: 1, borderColor: "#d9e2df", padding: 18 },
  resultTitle: { color: "#14212b", fontSize: 24, fontWeight: "900" },
  actionText: { color: "#0c6b58", fontSize: 18, fontWeight: "900", lineHeight: 26 },
  syncText: { color: "#657481", fontSize: 14, fontWeight: "700" },
  coach: { color: "#344554", fontSize: 16, lineHeight: 24, backgroundColor: "#eaf1ee", padding: 14, borderRadius: 8 },
  comparison: { gap: 6, backgroundColor: "#f4f8f6", borderRadius: 8, padding: 14 },
  comparisonTitle: { color: "#14212b", fontSize: 16, fontWeight: "900" },
  button: { alignItems: "center", justifyContent: "center", minHeight: 52, borderRadius: 9, paddingHorizontal: 18 },
  primary: { backgroundColor: "#0c6b58" },
  secondary: { backgroundColor: "#fff", borderColor: "#0c6b58", borderWidth: 1 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "900" },
  secondaryText: { color: "#0c6b58" },
  disabled: { opacity: 0.45 },
  readOnlyBanner: { color: "#6c4608", backgroundColor: "#fff0d7", padding: 12, borderRadius: 8, fontSize: 15 }
});
