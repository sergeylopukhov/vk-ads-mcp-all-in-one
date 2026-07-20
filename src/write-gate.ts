import { createHash, randomUUID } from "node:crypto";

export type TestWriteOperation = "create_url" | "create_test_ad_plan" | "create_test_campaign" | "create_test_ad_group" | "create_test_banner" | "create_test_segment" | "rename_test_ad_plan" | "rename_test_campaign" | "rename_test_ad_group" | "rename_test_banner" | "rename_test_segment" | "rename_test_lead_form" | "rename_test_remarketing_counter" | "delete_test_remarketing_counter" | "update_test_counter_goal" | "update_test_inapp_event_category" | "update_test_pricelist" | "create_test_async_report" | "delete_test_async_report" | "block_test_ad_plans" | "block_test_ad_groups" | "block_test_banners" | "remoderate_test_banners" | "delete_test_ad_plan" | "delete_test_ad_group" | "delete_test_segment" | "add_test_segment_relation" | "delete_test_segment_relation" | "upload_static_image" | "upload_html5" | "upload_test_video" | "upload_lead_form_logo" | "create_test_offer_batch" | "export_leads" | "export_survey_respondents" | "upload_test_remarketing_user_list" | "rename_test_remarketing_user_list" | "delete_test_remarketing_user_list" | "connect_agency_client" | "create_test_local_geo" | "update_test_local_geo" | "delete_test_local_geo" | "copy_test_lead_form" | "copy_test_survey_form" | "manage_test_lead_forms_archive" | "manage_test_survey_forms_archive" | "send_test_lead" | "create_test_sharing_key" | "revoke_created_sharing_key" | "share_test_skadnetwork_ids" | "withdraw_test_skadnetwork_ids";

export interface WritePreview {
  id: string;
  operation: TestWriteOperation;
  connection_id: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  expires_at: string;
  confirmation_statement: string;
}

export interface WriteAuditEntry {
  id: string;
  operation: TestWriteOperation;
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
  ) {}

  prepare(operation: TestWriteOperation, payload: Record<string, unknown>, connectionId = "default"): WritePreview {
    if (!this.enabled) throw new Error("Операции записи отключены: запустите сервер с VK_ADS_MODE=write.");
    const id = this.createId();
    const expiresAtMs = this.now() + 10 * 60 * 1_000;
    const payloadHash = createHash("sha256").update(canonicalize({ operation, connectionId, payload })).digest("hex");
    const preview: StoredPreview = {
      id,
      operation,
      connection_id: connectionId,
      payload,
      payload_hash: payloadHash,
      expires_at: new Date(expiresAtMs).toISOString(),
      confirmation_statement: `ПОДТВЕРЖДАЮ ${id}`,
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
    return this.publicPreview(preview);
  }

  consume(id: string, statement: string, connectionId = "default"): WritePreview {
    const preview = this.previews.get(id);
    if (!preview) throw new Error("Preview не найден или уже удалён.");
    if (preview.consumed) throw new Error("Preview уже использован; подготовьте новый.");
    if (this.now() > preview.expiresAtMs) {
      this.previews.delete(id);
      throw new Error("Срок подтверждения истёк; подготовьте новый preview.");
    }
    if (statement !== preview.confirmation_statement) throw new Error("Неверная фраза подтверждения.");
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
}
