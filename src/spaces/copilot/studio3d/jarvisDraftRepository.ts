import { supabase } from '@/lib/supabaseClient';
import { parseJarvisDraft, type JarvisDraft } from './jarvisDraft';

export interface SavedJarvisDraft {
  draft: JarvisDraft;
  status: 'draft' | 'validated';
  revision: number;
  updatedAt: string;
}

function readRow(row: Record<string, unknown>): SavedJarvisDraft {
  const draft = parseJarvisDraft(row.payload);
  if (!draft) throw new Error('Le dossier 3D enregistré est invalide.');
  return {
    draft,
    status: row.status === 'validated' ? 'validated' : 'draft',
    revision: typeof row.revision === 'number' ? row.revision : 0,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  };
}

export async function loadJarvisDraft(conversationId: string): Promise<SavedJarvisDraft | null> {
  const { data, error } = await supabase.from('copilot_studio3d_drafts')
    .select('payload,status,revision,updated_at')
    .eq('conversation_id', conversationId).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? readRow(data) : null;
}

export async function saveJarvisDraft(
  conversationId: string,
  draftInput: JarvisDraft,
  status: 'draft' | 'validated',
  revision: number,
): Promise<SavedJarvisDraft> {
  const draft = parseJarvisDraft(draftInput);
  if (!draft?.objectif) throw new Error('Décrivez au moins l’objectif du projet 3D.');
  const { data, error } = await supabase.rpc('save_copilot_studio3d_draft', {
    p_conversation_id: conversationId,
    p_payload: draft,
    p_status: status,
    p_revision: revision,
  });
  if (error) throw new Error(error.message);
  if (!data?.[0]) throw new Error('Enregistrement du dossier non confirmé.');
  return readRow(data[0]);
}
