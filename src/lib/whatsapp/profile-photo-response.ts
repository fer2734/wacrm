export function validateProfilePhoto(file: Pick<File, 'size' | 'type'>): string | null {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return 'Seleccioná una imagen JPG o PNG.';
  if (file.size === 0) return 'La imagen está vacía.';
  if (file.size > 5 * 1024 * 1024) return 'La imagen supera los 5 MB. Elegí una imagen más pequeña.';
  return null;
}

export async function readPhotoResponse(response: Response): Promise<{success?: boolean; error?: string}> {
  const text = await response.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { /* A proxy can return an HTML error page. */ }
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const value = body as Record<string, unknown>;
    if (typeof value.success === 'boolean' || typeof value.error === 'string') {
      return {success: value.success === true, error: typeof value.error === 'string' ? value.error : undefined};
    }
  }
  if (response.status === 413) throw new Error('El servidor rechazó el tamaño de la imagen. Elegí una imagen más pequeña.');
  if (response.status === 401 || response.status === 403 || response.redirected) throw new Error('La sesión venció o no tiene permiso. Iniciá sesión como administrador.');
  if (response.status === 404) throw new Error('La función de foto no está disponible en el servidor (HTTP 404). Recargá la página.');
  throw new Error(`El servidor no confirmó el cambio de foto (HTTP ${response.status}). Revisá la foto actual antes de volver a intentar.`);
}
