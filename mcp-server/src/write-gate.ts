import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type TestWriteOperation = "recover_token_limit" | "create_url" | "create_test_ad_plan" | "create_test_campaign" | "create_test_ad_group" | "create_test_banner" | "create_test_segment" | "create_test_pricelist" | "rename_test_ad_plan" | "rename_test_campaign" | "update_campaign_budget_limit_day" | "rename_test_ad_group" | "rename_test_banner" | "rename_test_segment" | "rename_test_lead_form" | "rename_test_remarketing_counter" | "delete_test_remarketing_counter" | "delete_test_remarketing_counter_v2" | "create_test_counter_goal" | "update_test_counter_goal" | "update_test_inapp_event_category" | "create_test_async_report" | "delete_test_async_report" | "block_test_ad_plans" | "block_test_ad_groups" | "block_test_banners" | "remoderate_test_banners" | "delete_test_ad_plan" | "delete_test_ad_group" | "delete_test_segment" | "add_test_segment_relation" | "update_test_segment_relation" | "delete_test_segment_relation" | "upload_static_image" | "upload_html5" | "upload_test_video" | "upload_lead_form_logo" | "create_test_offer_batch" | "export_leads" | "export_survey_respondents" | "upload_test_remarketing_user_list" | "upload_test_offline_goal" | "update_test_offline_goal" | "rename_test_remarketing_user_list" | "delete_test_remarketing_user_list" | "delete_test_remarketing_user_list_v3" | "connect_agency_client" | "update_agency_client" | "delete_agency_client" | "update_user_profile" | "update_manager_client" | "delete_manager_client" | "connect_existing_remarketing_counter" | "update_ord_partner_acts" | "update_ord_partner_pad" | "create_ord_partner_subagent" | "update_ord_partner_subagent" | "transfer_to_client" | "create_test_local_geo" | "update_test_local_geo" | "delete_test_local_geo" | "copy_test_lead_form" | "copy_test_survey_form" | "manage_test_lead_forms_archive" | "manage_test_survey_forms_archive" | "send_test_lead" | "create_test_sharing_key" | "revoke_created_sharing_key" | "share_test_skadnetwork_ids" | "withdraw_test_skadnetwork_ids" | "create_ad_plan" | "update_ad_plan" | "delete_ad_plan" | "manage_ad_plans" | "create_campaign" | "update_campaign" | "delete_campaign" | "create_ad_group" | "update_ad_group" | "delete_ad_group" | "manage_ad_groups" | "create_banner" | "update_banner" | "delete_banner" | "manage_banners" | "delete_subscription" | "refresh_apple_app_metadata" | "refresh_google_app_metadata" | "create_subscription" | "delete_test_offline_goal";

/** Расширения пишущих контрактов добавляются явно, без raw endpoint/payload. */
export type WriteOperation = Exclude<TestWriteOperation, "update_test_pricelist"> | "activate_configured_sharing_key" | "update_user_profile" | "delete_test_campaign";

export interface WritePreview {
  id: string;
  operation: WriteOperation;
  connection_id: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  expires_at: string;
  confirmation_statement: string;
}

export interface WriteAuditEntry {
  id: string;
  operation: WriteOperation;
  connection_id: string;
  status: "prepared" | "succeeded" | "failed";
  prepared_at: string;
  completed_at: string | null;
  result_hash: string | null;
}

interface StoredPreview extends WritePreview {
  expiresAtMs: number;
  consumed: boolean;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(object[key])}`).join(",")}}`;
}

export class WriteGate {
  private readonly previews = new Map<string, StoredPreview>();
  private readonly audit = new Map<string, WriteAuditEntry>();

  constructor(
    private readonly enabled: boolean,
    private readonly now: () => number = Date.now,
    private readonly createId: () => string = randomUUID,
    private readonly auditFile?: string,
    private readonly previewTtlMs = 10 * 60 * 1_000,
    private readonly requireConfirmation = true,
  ) {
    if (!Number.isInteger(previewTtlMs) || previewTtlMs < 60_000 || previewTtlMs > 60 * 60 * 1_000) {
      throw new Error("Preview TTL должен быть от 1 до 60 минут.");
    }
    this.loadAudit();
  }

  prepare(operation: WriteOperation, payload: Record<string, unknown>, connectionId = "default"): WritePreview {
    if (!this.enabled) throw new Error("Операции записи отключены: запустите сервер с VK_ADS_MODE=write.");
    const id = this.createId();
    const expiresAtMs = this.now() + this.previewTtlMs;
    const payloadHash = createHash("sha256").update(canonicalize({ operation, connectionId, payload })).digest("hex");
    const preview: StoredPreview = {
      id,
      operation,
      connection_id: connectionId,
      payload,
      payload_hash: payloadHash,
      expires_at: new Date(expiresAtMs).toISOString(),
      confirmation_statement: "ПОДТВЕРЖДАЮ",
      expiresAtMs,
      consumed: false,
    };
    this.previews.set(id, preview);
    this.audit.set(id, {
      id,
      operation,
      connection_id: connectionId,
      status: "prepared",
      prepared_at: new Date(this.now()).toISOString(),
      completed_at: null,
      result_hash: null,
    });
    this.persistAudit();
    return this.publicPreview(preview);
  }

  consume(id: string, statement: string | undefined, connectionId = "default"): WritePreview {
    const preview = this.previews.get(id);
    if (!preview) throw new Error("Preview не найден или уже удалён.");
    if (preview.consumed) throw new Error("Preview уже использован; подготовьте новый.");
    if (this.now() > preview.expiresAtMs) {
      this.previews.delete(id);
      throw new Error("Срок подтверждения истёк; подготовьте новый preview.");
    }
    if (this.requireConfirmation && statement !== preview.confirmation_statement) throw new Error("Неверная фраза подтверждения.");
    if (preview.connection_id !== connectionId) throw new Error("Подтверждение подготовлено для другого подключения VK Ads.");
    preview.consumed = true;
    return this.publicPreview(preview);
  }

  complete(preview: WritePreview, status: "succeeded" | "failed", result?: unknown): WriteAuditEntry {
    const entry = this.audit.get(preview.id);
    if (!entry) throw new Error("Запись аудита не найдена.");
    const completed: WriteAuditEntry = {
      ...entry,
      status,
      completed_at: new Date(this.now()).toISOString(),
      result_hash: result === undefined ? null : createHash("sha256").update(canonicalize(result)).digest("hex"),
    };
    this.audit.set(preview.id, completed);
    this.persistAudit();
    return completed;
  }

  listAudit(limit = 100): WriteAuditEntry[] {
    return [...this.audit.values()]
      .sort((left, right) => right.prepared_at.localeCompare(left.prepared_at))
      .slice(0, limit);
  }

  private publicPreview(preview: StoredPreview): WritePreview {
    const { expiresAtMs: _expiresAtMs, consumed: _consumed, ...publicPreview } = preview;
    return publicPreview;
  }

  private loadAudit(): void {
    if (!this.auditFile) return;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.auditFile, "utf8"));
      if (!Array.isArray(parsed)) return;
      for (const item of parsed) {
        if (!isAuditEntry(item)) continue;
        this.audit.set(item.id, item);
      }
    } catch (error: unknown) {
      if (isMissingFileError(error)) return;
      throw new Error("Не удалось прочитать локальный audit write-операций.");
    }
  }

  private persistAudit(): void {
    if (!this.auditFile) return;
    mkdirSync(dirname(this.auditFile), { recursive: true });
    const temporary = `${this.auditFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify([...this.audit.values()]), { encoding: "utf8", mode: 0o600 });
    renameSync(temporary, this.auditFile);
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isAuditEntry(value: unknown): value is WriteAuditEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string"
    && typeof entry.operation === "string"
    && typeof entry.connection_id === "string"
    && (entry.status === "prepared" || entry.status === "succeeded" || entry.status === "failed")
    && typeof entry.prepared_at === "string"
    && (entry.completed_at === null || typeof entry.completed_at === "string")
    && (entry.result_hash === null || typeof entry.result_hash === "string");
}
