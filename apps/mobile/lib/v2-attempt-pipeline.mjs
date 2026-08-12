export function createV2AttemptPipeline({ api, native, normalizer, outbox, ticketJournal, protectedTicketStore, ids, clock, triggerSync }) {
  let active = null;
  return Object.freeze({
    async start({ item, userId, purpose = "initial" }) {
      if (active) throw codedError("ASSESSMENT_ALREADY_ACTIVE");
      const reusable=await ticketJournal.findReusable(userId,item.id,purpose);
      const handle=reusable?.protected_material_handle??ids.materialHandle();
      const ticketRequestId=reusable?.ticket_request_id??ids.ticketRequestId();
      let nonce=await protectedTicketStore.read(handle);
      if(!nonce){nonce=ids.ticketNonce();await protectedTicketStore.save(handle,nonce);}
      if(!reusable) await ticketJournal.begin({ticketRequestId,userId,sessionItemId:item.id,attemptPurpose:purpose,protectedMaterialHandle:handle});
      let token;
      if(reusable){
        try{token=await api.recoverSpeechToken(ticketRequestId,nonce);}
        catch(error){
          if(!new Set(["ASSESSMENT_TICKET_INVALID","ASSESSMENT_TICKET_NOT_FOUND"]).has(error?.code)) throw error;
          token=await api.speechToken(item.id,purpose,ticketRequestId,nonce);
        }
      }else token=await api.speechToken(item.id,purpose,ticketRequestId,nonce);
      await ticketJournal.markReady(userId,ticketRequestId,{
        captureExpiresAt:token.assessment_ticket.capture_expires_at,
        submissionExpiresAt:token.assessment_ticket.submission_expires_at
      });
      const requestId = ids.requestId();
      try {
        await native.prepare({
          token: token.token,
          region: token.region,
          locale: token.locale,
          referenceText: token.reference_text,
          requestId
        });
        await native.start(requestId);
      } catch (error) {
        try{
          await api.cancelSpeechToken(ticketRequestId,nonce);
          await ticketJournal.markCancelled?.(userId,ticketRequestId);
          await protectedTicketStore.delete(handle);
        }catch{/* keep the journal and nonce so response-loss recovery can retry cancellation */}
        throw error;
      }
      active = { item,userId,purpose,token,handle,requestId,ticketRequestId,recordingStartedAt:clock.now() };
      return { requestId, captureExpiresAt: token.assessment_ticket.capture_expires_at ?? token.assessment_ticket.expires_at };
    },

    async finish({ payloadByteLimit, userId, sessionId, deletionEpoch, onLocalResult }) {
      if (!active) throw codedError("ASSESSMENT_NOT_ACTIVE");
      const context = active;
      active = null;
      let nativeResult;
      let enqueued = false;
      try {
        nativeResult = await native.finish(context.requestId);
        const effectivePayloadLimit = payloadByteLimit ?? context.token.provider_projection_max_bytes;
        if (!Number.isSafeInteger(effectivePayloadLimit) || effectivePayloadLimit <= 0) {
          throw codedError("PROVIDER_PROJECTION_LIMIT_REQUIRED");
        }
        const providerResultReceivedAt = clock.now();
        const capturedAt = providerResultReceivedAt;
        const projected = normalizer({
          providerPayload: nativeResult.rawJson,
          payloadByteLimit: effectivePayloadLimit,
          targetLocator: context.item.target_locator,
          referenceText: context.item.reference_text,
          contentVersionId: context.item.content_version_id,
          practiceItemKey: context.item.practice_item_key,
          expectedFocusRepresentation: context.item.expected_focus_representation,
          nextActionKey: context.item.next_action_key ?? undefined,
          referenceTextVersion: context.item.reference_text_version
        });
        // Drop the only reference to the provider response before durable storage.
        nativeResult.rawJson = undefined;
        const commandId = ids.commandId();
        const clientAttemptId = ids.clientAttemptId();
        const localResult = {
          expectedFocus: projected.normalized.expectedFocusRepresentation,
          observedCandidate: projected.normalized.observedCandidate,
          targetScore: projected.normalized.targetScore,
          resultLabel: projected.normalized.resultLabel,
          nextActionKey: projected.normalized.nextActionKey,
          technicalValid: projected.normalized.technicalValid
        };
        await outbox.enqueue({
          commandId,
          commandKind: "attempt",
          userId,
          clientAttemptId,
          sessionId,
          sessionItemId: context.item.id,
          contentVersionId: context.item.content_version_id,
          focusGroupKey: context.item.focus_group_key,
          assessmentLocale: "en-US",
          deletionEpoch,
          referenceVersion: context.item.reference_text_version,
          normalizerVersion: projected.normalized.normalizerVersion,
          projectionVersion: projected.projection.projectionVersion,
          contractVersion: context.token.contract_version,
          assessmentTicketId: context.token.assessment_ticket.id,
          ticketRequestId: context.ticketRequestId,
          protectedMaterialHandle: context.handle,
          recordingStartedAt: context.recordingStartedAt,
          capturedAt,
          providerResultReceivedAt,
          captureExpiresAt: context.token.assessment_ticket.capture_expires_at ?? context.token.assessment_ticket.expires_at,
          submissionExpiresAt: context.token.assessment_ticket.submission_expires_at,
          dependencyCommandId: context.item.dependency_command_id ?? null,
          strictProjection: projected.projection,
          createdAt: capturedAt
        }, localResult);
        await ticketJournal.markConsumed(context.userId,context.ticketRequestId);
        enqueued = true;
        // The primary result is available after the local transaction, before server acknowledgement.
        await onLocalResult({ ...localResult, syncState: "pending", commandId, localAudioSource: nativeResult.localAudioUri });
        void triggerSync();
        return {
          commandId,
          localResult,
          metrics: projected.metrics,
          submissionExpiresAt: context.token.assessment_ticket.submission_expires_at
        };
      } catch (error) {
        if (nativeResult?.localAudioUri) await native.deleteTemporary(nativeResult.localAudioUri).catch(() => undefined);
        if (!enqueued) await protectedTicketStore.delete(context.handle);
        throw error;
      }
    },

    async cancel() {
      if (!active) return;
      const context = active;
      active = null;
      await native.cancel(context.requestId).catch(() => undefined);
      const nonce=await protectedTicketStore.read(context.handle);
      if(nonce) try{
        await api.cancelSpeechToken(context.ticketRequestId,nonce);
        await ticketJournal.markCancelled?.(context.userId,context.ticketRequestId);
        await protectedTicketStore.delete(context.handle);
      }catch{/* keep protected material for recover/cancel retry */}
    },
    get active(){return active!==null;}
  });
}

function codedError(code) {
  return Object.assign(new Error(code), { code });
}
