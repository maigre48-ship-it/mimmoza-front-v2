import { supabase } from '@/lib/supabaseClient';
import { BUCKET_TRANSFERT, televerserTransfert, TYPES_PLAN } from './transfertStudio';
import type { CopilotAttachment } from '../types/copilot.types';
import type { FichierTransfert } from './transfertStudio';

export interface JarvisStoredFile extends FichierTransfert {
  kind: 'image' | 'pdf';
}

/** Les fichiers 3D sont conservés sous l'ID de conversation, dans le bucket privé. */
export async function retainJarvisFiles(conversationId: string, attachments: readonly CopilotAttachment[]): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId) || attachments.length === 0) return;
  const session = conversationId;
  for (const attachment of attachments) {
    if (!TYPES_PLAN.includes(attachment.mediaType)) continue;
    // V1.8 : une pièce envoyée par stockage (> 3 Mo) n'a pas de base64 : elle
    // reste dans copilot-pieces-jointes et n'est pas recopiée dans le dossier 3D.
    if (!attachment.data) continue;
    const bytes = Uint8Array.from(atob(attachment.data), c => c.charCodeAt(0));
    const file = new File([bytes], attachment.name ?? 'piece-jointe', { type: attachment.mediaType });
    await televerserTransfert(session, file, TYPES_PLAN);
  }
  window.dispatchEvent(new CustomEvent('mzia-3d-files-changed', { detail: conversationId }));
}

export async function listJarvisTransferFiles(conversationId: string): Promise<JarvisStoredFile[]> {
  if (!/^[0-9a-f-]{36}$/i.test(conversationId)) return [];
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return [];
  const { data, error } = await supabase.storage.from(BUCKET_TRANSFERT)
    .list(`${auth.user.id}/${conversationId}`, { limit: 100 });
  if (error) throw new Error(error.message);
  return (data ?? []).filter(file => file.name && !file.name.startsWith('.'))
    .flatMap(file => {
      const lower = file.name.toLowerCase();
      const kind = lower.endsWith('.pdf') ? 'pdf'
        : /\.(jpe?g|png|webp)$/.test(lower) ? 'image' : null;
      if (!kind) return [];
      return [{
        path: `${auth.user!.id}/${conversationId}/${file.name}`,
        nom: file.name.replace(/^[0-9a-f-]{36}-/i, '').replace(/_/g, ' '),
        kind,
      } satisfies JarvisStoredFile];
    });
}

export async function listJarvisFiles(conversationId: string): Promise<string[]> {
  return (await listJarvisTransferFiles(conversationId)).map(file => file.nom);
}
