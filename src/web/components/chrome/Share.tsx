import { cn } from "cn";
import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/analytics";
import { FORMATS, FORMAT_KEYS, socialImagePath, type Format } from "@/share";
import { IconButton } from "@/components/ui/IconButton";
import { IconClose } from "@/components/ui/icons";
import { SegButton } from "@/components/ui/SegButton";
import { Segmented } from "@/components/ui/Segmented";

function ShareHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="share-head">
      <span className="share-title">Dela</span>
      <span className="share-page">{title}</span>
      <IconButton label="Stäng" onClick={onClose}>
        <IconClose />
      </IconButton>
    </div>
  );
}

function FormatPicker({ format, onFormat }: { format: Format; onFormat: (format: Format) => void }) {
  return (
    <Segmented label="Format" className="share-formats">
      {FORMAT_KEYS.map((k) => (
        <SegButton key={k} active={k === format} onClick={() => onFormat(k)}>
          {FORMATS[k].label}
          <span className="ratio">{FORMATS[k].ratio}</span>
        </SegButton>
      ))}
    </Segmented>
  );
}

function SharePreview({ loaded, open, src, alt, w, h, ratio, onLoad }: { loaded: boolean; open: boolean; src: string | null; alt: string; w: number; h: number; ratio: string; onLoad: () => void }) {
  return (
    <div className={cn("share-preview", loaded && "loaded")} style={{ aspectRatio: ratio }}>
      {open && src && <img src={src} alt={alt} width={w} height={h} onLoad={onLoad} />}
    </div>
  );
}

function ShareActions({
  canShareFiles,
  busy,
  loaded,
  href,
  fileName,
  onShare,
  onDownload,
  onCopy,
}: {
  canShareFiles: boolean;
  busy: boolean;
  loaded: boolean;
  href: string;
  fileName: string;
  onShare: () => void;
  onDownload: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="share-actions">
      {canShareFiles && (
        <button type="button" className="primary" disabled={busy || !loaded} onClick={onShare}>
          Dela bild
        </button>
      )}
      <a className={cn(!canShareFiles && "primary")} href={href} download={fileName} onClick={onDownload}>
        Ladda ner
      </a>
      <button type="button" onClick={onCopy}>
        Kopiera länk
      </button>
    </div>
  );
}

/**
 * Share the chart on screen: pick a format, see the image the server draws
 * for this URL, and share it through the system share sheet where there is
 * one (phones), or download it. The page link can always be copied.
 */
export function Share({ open, onClose, title }: { open: boolean; onClose: () => void; title: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [format, setFormat] = useState<Format>("square");
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pageUrl = window.location.href;
  const imagePath = socialImagePath(new URL(pageUrl), format);
  const canShareFiles = typeof navigator.canShare === "function" && navigator.canShare({ files: [new File([], "x.png", { type: "image/png" })] });

  // A native dialog: modal, with Esc and a focus trap for free.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      setNote(null);
    } else if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => setLoaded(false), [format, imagePath]);

  const fileName = `statsbudgeten-${title.toLowerCase().replace(/[^a-z0-9åäö]+/g, "-").replace(/^-|-$/g, "")}-${format}.png`;

  const shareImage = async () => {
    if (!imagePath) return;
    setBusy(true);
    try {
      const blob = await (await fetch(imagePath)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const withLink = { files: [file], title, text: `${title} – Statsbudgeten`, url: pageUrl };
      // Some browsers refuse a link next to files; then the text carries it.
      const data = navigator.canShare?.(withLink) ? withLink : { files: [file], title, text: `${title} – ${pageUrl}` };
      await navigator.share(data);
      trackEvent("share", { method: "share_sheet", format });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setNote("Kunde inte dela, ladda ner bilden i stället.");
    } finally {
      setBusy(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setNote("Länken är kopierad.");
      trackEvent("share", { method: "copy_link", format });
    } catch {
      setNote(pageUrl);
    }
  };

  const spec = FORMATS[format];
  return (
    <dialog
      ref={ref}
      className="share"
      aria-label="Dela"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog itself.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <ShareHead title={title} onClose={onClose} />
      <FormatPicker format={format} onFormat={setFormat} />
      <SharePreview loaded={loaded} open={open} src={imagePath} alt={`${title}, ${spec.label} ${spec.ratio}`} w={spec.w} h={spec.h} ratio={`${spec.w} / ${spec.h}`} onLoad={() => setLoaded(true)} />
      <ShareActions
        canShareFiles={canShareFiles}
        busy={busy}
        loaded={loaded}
        href={imagePath ?? "#"}
        fileName={fileName}
        onShare={shareImage}
        onDownload={() => trackEvent("share", { method: "download", format })}
        onCopy={copyLink}
      />
      <div className="share-note" role="status">
        {note ?? `${spec.w} × ${spec.h} px`}
      </div>
    </dialog>
  );
}
