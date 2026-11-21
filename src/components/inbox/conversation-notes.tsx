"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Save, StickyNote, X } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { ContactNote } from "@/types";

export function ConversationNotes({ contactId, editSignal = 0 }: { contactId: string; editSignal?: number }) {
  const { user, accountId } = useAuth();
  const [notes, setNotes] = useState<ContactNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const previousEditSignal = useRef(editSignal);

  const refresh = useCallback(async () => {
    const { data, error } = await createClient()
      .from("contact_notes")
      .select("id,contact_id,user_id,account_id,note_text,created_at")
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false });
    if (error) console.error("Error cargando notas:", error.message);
    else setNotes((data ?? []) as ContactNote[]);
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    void refresh();
    const supabase = createClient();
    const onChanged = () => { void refresh(); };
    window.addEventListener("wacrm:contact-notes-changed", onChanged);
    const subscription = supabase.channel("chat-notes-" + contactId)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "contact_notes",
        filter: "contact_id=eq." + contactId
      }, onChanged).subscribe();
    const timer = window.setInterval(onChanged, 30000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("wacrm:contact-notes-changed", onChanged);
      void supabase.removeChannel(subscription);
    };
  }, [contactId, refresh]);

  useEffect(() => {
    if (editSignal > previousEditSignal.current) {
      setEditingId(null);
      setDraft("");
      setAdding(true);
    }
    previousEditSignal.current = editSignal;
  }, [editSignal]);

  useEffect(() => {
    if (adding || editingId) input.current?.focus();
  }, [adding, editingId]);

  function newNote() {
    setDraft("");
    setEditingId(null);
    setAdding(true);
  }

  function editNote(note: ContactNote) {
    setDraft(note.note_text);
    setAdding(false);
    setEditingId(note.id);
  }

  function cancel() {
    setEditingId(null);
    setAdding(false);
    setDraft("");
  }

  async function save() {
    if (!user || !accountId || !draft.trim() || saving) return;
    setSaving(true);
    try {
      if (editingId) {
        const { data, error } = await createClient().from("contact_notes")
          .update({ note_text: draft.trim() })
          .eq("id", editingId).eq("contact_id", contactId)
          .select("id").maybeSingle();
        if (error || !data) {
          toast.error("No se pudo actualizar la nota");
          return;
        }
      } else {
        const { error } = await createClient().from("contact_notes").insert({
          contact_id: contactId, account_id: accountId, user_id: user.id, note_text: draft.trim()
        });
        if (error) {
          toast.error("No se pudo guardar la nota");
          return;
        }
      }
      cancel();
      void refresh();
      window.dispatchEvent(new Event("wacrm:contact-notes-changed"));
      toast.success("Nota guardada");
    } catch {
      toast.error("No se pudo guardar la nota");
    } finally {
      setSaving(false);
    }
  }

  const formOpen = adding || editingId !== null;

  return (
    <section className="shrink-0 border-b border-border bg-card px-3 py-2" aria-label="Notas de seguimiento">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
          <StickyNote className="size-3.5 shrink-0 text-primary" /> Notas de seguimiento
        </h3>
        <div className="flex shrink-0 items-center gap-2">
          {notes.length > 1 && (
            <button type="button" onClick={() => setShowAll(v => !v)}
              className="text-[11px] font-medium text-primary underline">
              {showAll ? "Ver menos" : "Ver todas (" + notes.length + ")"}
            </button>
          )}
          <button type="button" onClick={newNote}
            className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium hover:bg-muted">
            <Plus className="size-3.5" /> Nueva
          </button>
        </div>
      </div>
      {loading ? (
        <p className="mt-1 text-xs text-muted-foreground">Cargando notas...</p>
      ) : notes.length === 0 && !formOpen ? (
        <button type="button" onClick={newNote} className="mt-1 text-left text-xs text-muted-foreground hover:text-foreground">
          Sin notas. Tocá para agregar una.
        </button>
      ) : (
        <div className="mt-1 max-h-40 space-y-1 overflow-y-auto">
          {(showAll ? notes : notes.slice(0, 1)).map(note => (
            <div key={note.id} className="flex items-start justify-between gap-2 rounded-md bg-muted/50 px-2 py-1.5">
              <div className="min-w-0">
                <p className="max-h-20 overflow-y-auto whitespace-pre-wrap break-words text-xs text-foreground">{note.note_text}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {note.created_at ? new Date(note.created_at).toLocaleString("es-AR") : ""}
                </p>
              </div>
              <button type="button" title="Editar nota" aria-label="Editar nota" onClick={() => editNote(note)}
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-primary hover:bg-muted">
                <Pencil className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      {formOpen && (
        <div className="mt-2 space-y-2">
          <label className="block text-xs font-medium" htmlFor="chat-note-editor">
            {editingId ? "Editar nota" : "Nueva nota"}
          </label>
          <textarea id="chat-note-editor" ref={input} value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder="Escribí la novedad del cliente..." rows={2} maxLength={10000}
            className="min-h-16 w-full resize-y rounded-md border border-input bg-background p-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancel} disabled={saving}
              className="inline-flex min-h-8 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-muted">
              <X className="size-3.5" /> Cancelar
            </button>
            <button type="button" onClick={() => void save()} disabled={saving || !draft.trim()}
              className="inline-flex min-h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              <Save className="size-3.5" /> {saving ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
