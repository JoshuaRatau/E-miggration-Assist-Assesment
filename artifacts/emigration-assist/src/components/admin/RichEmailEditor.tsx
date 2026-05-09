import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Underline from "@tiptap/extension-underline";
import { useEffect, useRef, useState } from "react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link as LinkIcon,
  Image as ImageIcon,
  Code as CodeIcon,
  Eye,
  Smartphone,
  Monitor,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Mode = "wysiwyg" | "html" | "preview";
type PreviewDevice = "desktop" | "mobile";

export interface RichEmailEditorProps {
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  testId?: string;
  /** Visual height of the editor surface in px. Defaults to 360. */
  minHeight?: number;
}

/**
 * Phase 6D-2 — TipTap-based rich HTML editor for email templates +
 * campaign bodies. Three modes:
 *   - wysiwyg : visual editing
 *   - html    : raw source (so power users can paste branded HTML)
 *   - preview : sandboxed iframe rendering with desktop/mobile toggle
 *
 * Image upload posts to `POST /api/admin/uploads/image` (admin auth)
 * and inserts the returned `{ url }` as an `<img>` node.
 *
 * The component is uncontrolled-ish: we sync `value` → editor only when
 * it differs from the editor's current HTML, to avoid the cursor jumping
 * on every keystroke.
 */
export function RichEmailEditor(props: RichEmailEditorProps) {
  const { value, onChange, disabled, testId, minHeight = 360 } = props;
  const [mode, setMode] = useState<Mode>("wysiwyg");
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>("desktop");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Image.configure({ inline: false, allowBase64: false }),
    ],
    content: value || "",
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  // External value sync (e.g. "Load from template" populates the body).
  // We pass `emitUpdate: false` so this programmatic change does NOT echo
  // back through onUpdate — that avoids both the parent→editor→parent
  // ping-pong loop AND the previous-revision suppression-flag bug that
  // dropped the user's first real edit after a sync.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() === value) return;
    editor.commands.setContent(value || "", { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.setEditable(!disabled);
  }, [disabled, editor]);

  async function handleImageFile(file: File) {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin/uploads/image", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Upload failed (${res.status})`);
      }
      const { url } = (await res.json()) as { url: string };
      editor?.chain().focus().setImage({ src: url, alt: file.name }).run();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function promptForLink() {
    if (!editor) return;
    const previous = editor.getAttributes("link")["href"] as string | undefined;
    const url = window.prompt("URL (leave blank to remove)", previous ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }

  return (
    <div
      className="rounded-md border border-slate-700 bg-slate-950/40"
      data-testid={testId}
    >
      <Toolbar
        editor={editor}
        mode={mode}
        setMode={setMode}
        disabled={disabled}
        uploading={uploading}
        onImageClick={() => fileInputRef.current?.click()}
        onLinkClick={promptForLink}
        previewDevice={previewDevice}
        setPreviewDevice={setPreviewDevice}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImageFile(f);
          e.target.value = "";
        }}
      />
      {uploadError ? (
        <div className="border-t border-rose-900/50 bg-rose-950/40 px-3 py-1.5 text-xs text-rose-300">
          {uploadError}
        </div>
      ) : null}

      {mode === "wysiwyg" ? (
        <EditorContent
          editor={editor}
          className="rich-email-editor px-3 py-3 text-sm text-slate-100"
          style={{ minHeight }}
        />
      ) : null}

      {mode === "html" ? (
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={Math.max(10, Math.round(minHeight / 22))}
          className="rounded-none border-0 bg-slate-950/40 font-mono text-xs"
          style={{ minHeight }}
        />
      ) : null}

      {mode === "preview" ? (
        <div className="bg-slate-900/40 px-3 py-3">
          <div
            className="mx-auto overflow-hidden rounded border border-slate-700 bg-white"
            style={{
              maxWidth: previewDevice === "desktop" ? 680 : 380,
              transition: "max-width 200ms ease",
            }}
          >
            <iframe
              title="Email preview"
              srcDoc={`<!doctype html><meta charset="utf-8"><base target="_blank">${value || "<p style='padding:24px;color:#64748b'>Empty</p>"}`}
              sandbox=""
              className="block w-full border-0"
              style={{ minHeight }}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Toolbar(props: {
  editor: Editor | null;
  mode: Mode;
  setMode: (m: Mode) => void;
  disabled?: boolean;
  uploading: boolean;
  onImageClick: () => void;
  onLinkClick: () => void;
  previewDevice: PreviewDevice;
  setPreviewDevice: (d: PreviewDevice) => void;
}) {
  const {
    editor,
    mode,
    setMode,
    disabled,
    uploading,
    onImageClick,
    onLinkClick,
    previewDevice,
    setPreviewDevice,
  } = props;
  const ed = editor;
  const isWys = mode === "wysiwyg";
  const formatDisabled = disabled || !isWys || !ed;

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-slate-700 bg-slate-900/60 px-2 py-1.5">
      <ToolbarBtn
        active={!!ed?.isActive("bold")}
        disabled={formatDisabled}
        onClick={() => ed?.chain().focus().toggleBold().run()}
        title="Bold"
        testId="editor-bold"
      >
        <Bold className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        active={!!ed?.isActive("italic")}
        disabled={formatDisabled}
        onClick={() => ed?.chain().focus().toggleItalic().run()}
        title="Italic"
        testId="editor-italic"
      >
        <Italic className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        active={!!ed?.isActive("underline")}
        disabled={formatDisabled}
        onClick={() => ed?.chain().focus().toggleUnderline().run()}
        title="Underline"
        testId="editor-underline"
      >
        <UnderlineIcon className="h-3.5 w-3.5" />
      </ToolbarBtn>

      <ToolbarSep />

      <ToolbarBtn
        active={!!ed?.isActive("heading", { level: 1 })}
        disabled={formatDisabled}
        onClick={() => ed?.chain().focus().toggleHeading({ level: 1 }).run()}
        title="Heading 1"
      >
        <Heading1 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        active={!!ed?.isActive("heading", { level: 2 })}
        disabled={formatDisabled}
        onClick={() => ed?.chain().focus().toggleHeading({ level: 2 }).run()}
        title="Heading 2"
      >
        <Heading2 className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        active={!!ed?.isActive("heading", { level: 3 })}
        disabled={formatDisabled}
        onClick={() => ed?.chain().focus().toggleHeading({ level: 3 }).run()}
        title="Heading 3"
      >
        <Heading3 className="h-3.5 w-3.5" />
      </ToolbarBtn>

      <ToolbarSep />

      <ToolbarBtn
        active={!!ed?.isActive("bulletList")}
        disabled={formatDisabled}
        onClick={() => ed?.chain().focus().toggleBulletList().run()}
        title="Bullet list"
      >
        <List className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        active={!!ed?.isActive("orderedList")}
        disabled={formatDisabled}
        onClick={() => ed?.chain().focus().toggleOrderedList().run()}
        title="Ordered list"
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </ToolbarBtn>

      <ToolbarSep />

      <ToolbarBtn
        active={!!ed?.isActive("link")}
        disabled={formatDisabled}
        onClick={onLinkClick}
        title="Insert / edit link"
        testId="editor-link"
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </ToolbarBtn>
      <ToolbarBtn
        disabled={formatDisabled || uploading}
        onClick={onImageClick}
        title="Insert image (max 5MB)"
        testId="editor-image"
      >
        {uploading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <ImageIcon className="h-3.5 w-3.5" />
        )}
      </ToolbarBtn>

      <div className="ml-auto flex items-center gap-1">
        {mode === "preview" ? (
          <div className="mr-1 flex items-center gap-0.5 rounded-md border border-slate-700 bg-slate-950/60 p-0.5">
            <ToolbarBtn
              small
              active={previewDevice === "desktop"}
              onClick={() => setPreviewDevice("desktop")}
              title="Desktop preview"
            >
              <Monitor className="h-3.5 w-3.5" />
            </ToolbarBtn>
            <ToolbarBtn
              small
              active={previewDevice === "mobile"}
              onClick={() => setPreviewDevice("mobile")}
              title="Mobile preview"
            >
              <Smartphone className="h-3.5 w-3.5" />
            </ToolbarBtn>
          </div>
        ) : null}
        <ModeBtn active={mode === "wysiwyg"} onClick={() => setMode("wysiwyg")}>
          Visual
        </ModeBtn>
        <ModeBtn active={mode === "html"} onClick={() => setMode("html")}>
          <CodeIcon className="mr-1 inline h-3 w-3" />
          HTML
        </ModeBtn>
        <ModeBtn active={mode === "preview"} onClick={() => setMode("preview")}>
          <Eye className="mr-1 inline h-3 w-3" />
          Preview
        </ModeBtn>
      </div>
    </div>
  );
}

function ToolbarBtn(props: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  testId?: string;
  small?: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      aria-label={props.title}
      aria-pressed={props.active ?? undefined}
      data-testid={props.testId}
      className={`h-7 ${props.small ? "w-7 px-0" : "px-2"} text-slate-300 hover:bg-slate-800 hover:text-slate-100 ${
        props.active ? "bg-slate-700 text-white" : ""
      }`}
    >
      {props.children}
    </Button>
  );
}

function ToolbarSep() {
  return <div className="mx-0.5 h-5 w-px bg-slate-700" />;
}

function ModeBtn(props: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={props.onClick}
      className={`h-7 px-2 text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100 ${
        props.active ? "bg-slate-700 text-white" : ""
      }`}
    >
      {props.children}
    </Button>
  );
}
