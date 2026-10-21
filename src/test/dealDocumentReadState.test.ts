import { describe, expect, it, vi } from "vitest";

// readState is pure, but its module also holds the queries; keep the client out.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/persistDealScore", () => ({ persistDealScore: vi.fn() }));

import { readState, STALE_READ_MS, type DealDocument } from "@/hooks/useDealDocuments";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const doc = (over: Partial<DealDocument>): DealDocument => ({
  id: "d",
  deal_id: "x",
  storage_path: "x/d.pdf",
  file_name: "OM.pdf",
  file_size: 1,
  content_type: "application/pdf",
  uploaded_by: null,
  doc_type: null,
  doc_as_of: null,
  doc_property_name: null,
  doc_unit_count: null,
  doc_address: null,
  parse_status: "pending",
  parse_error: null,
  parse_notes: null,
  summary: null,
  detail_status: null,
  parse_started_at: null,
  parsed_at: null,
  created_at: ago(0),
  ...over,
});

describe("readState", () => {
  it("shows a just-uploaded document as reading", () => {
    expect(readState(doc({ created_at: ago(30_000) }))).toBe("reading");
  });

  it("shows a document that was never started as stopped, so it can be read again", () => {
    expect(readState(doc({ created_at: ago(STALE_READ_MS + 1000) }))).toBe("stopped");
  });

  it("keeps a live read as reading and a killed one as stopped", () => {
    const old = ago(STALE_READ_MS + 1000);
    expect(readState(doc({ parse_status: "parsing", created_at: old, parse_started_at: ago(60_000) }))).toBe("reading");
    expect(readState(doc({ parse_status: "parsing", created_at: old, parse_started_at: old }))).toBe("stopped");
  });

  it("leaves failed and parsed documents alone", () => {
    const old = ago(STALE_READ_MS + 1000);
    expect(readState(doc({ parse_status: "failed", created_at: old }))).toBe("failed");
    expect(readState(doc({ parse_status: "parsed", created_at: old, detail_status: "done" }))).toBe("done");
  });
});
