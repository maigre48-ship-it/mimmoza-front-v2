export async function loadImageDataUrl(
  url: string,
): Promise<{ dataUrl: string; aspect: number }> {
  const res  = await fetch(url);
  const blob = await res.blob();
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
  const aspect = await new Promise<number>((resolve) => {
    const img = new Image();
    img.onload  = () => resolve(img.naturalWidth / img.naturalHeight || 3.2);
    img.onerror = () => resolve(3.2);
    img.src = dataUrl;
  });
  return { dataUrl, aspect };
}