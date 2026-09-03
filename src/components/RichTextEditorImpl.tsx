import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import {
  Bold as BoldIcon,
  Italic as ItalicIcon,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  RemoveFormatting,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  className?: string;
  onSubmit?: () => void;
  autoFocus?: boolean;
}

export function RichTextEditor({
  value,
  onChange,
  placeholder,
  className,
  onSubmit,
  autoFocus,
}: RichTextEditorProps) {
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
    ],
    content: value || "",
    autofocus: autoFocus ?? false,
    editorProps: {
      attributes: {
        class:
          "prose prose-sm dark:prose-invert max-w-none min-h-[120px] px-3 py-2 focus:outline-none",
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          const fn = onSubmitRef.current;
          if (fn) {
            event.preventDefault();
            fn();
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      onChange(editor.isEmpty ? "" : html);
    },
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const next = value || "";
    const normalizedCurrent = editor.isEmpty ? "" : current;
    if (next !== normalizedCurrent && !editor.isFocused) {
      editor.commands.setContent(next, { emitUpdate: false });
    }
  }, [value, editor]);

  if (!editor) {
    return (
      <div className={cn("rounded-md border bg-background", className)}>
        <div className="h-10 border-b" />
        <div className="min-h-[120px]" />
      </div>
    );
  }

  const setLink = () => {
    const previous = (editor.getAttributes("link").href as string | undefined) ?? "";
    const url = window.prompt("Enter URL", previous);
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: normalized, target: "_blank", rel: "noopener noreferrer" })
      .run();
  };

  return (
    <div className={cn("rounded-md border bg-background", className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b p-1">
        <Toggle size="sm" pressed={editor.isActive("bold")} onPressedChange={() => editor.chain().focus().toggleBold().run()} aria-label="Bold">
          <BoldIcon className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("italic")} onPressedChange={() => editor.chain().focus().toggleItalic().run()} aria-label="Italic">
          <ItalicIcon className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("underline")} onPressedChange={() => editor.chain().focus().toggleUnderline().run()} aria-label="Underline">
          <UnderlineIcon className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("strike")} onPressedChange={() => editor.chain().focus().toggleStrike().run()} aria-label="Strikethrough">
          <Strikethrough className="h-3.5 w-3.5" />
        </Toggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Toggle size="sm" pressed={editor.isActive("heading", { level: 1 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} aria-label="Heading 1">
          <Heading1 className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("heading", { level: 2 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} aria-label="Heading 2">
          <Heading2 className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("heading", { level: 3 })} onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} aria-label="Heading 3">
          <Heading3 className="h-3.5 w-3.5" />
        </Toggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Toggle size="sm" pressed={editor.isActive("bulletList")} onPressedChange={() => editor.chain().focus().toggleBulletList().run()} aria-label="Bullet list">
          <List className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("orderedList")} onPressedChange={() => editor.chain().focus().toggleOrderedList().run()} aria-label="Numbered list">
          <ListOrdered className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("blockquote")} onPressedChange={() => editor.chain().focus().toggleBlockquote().run()} aria-label="Blockquote">
          <Quote className="h-3.5 w-3.5" />
        </Toggle>
        <Toggle size="sm" pressed={editor.isActive("code")} onPressedChange={() => editor.chain().focus().toggleCode().run()} aria-label="Inline code">
          <Code className="h-3.5 w-3.5" />
        </Toggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <Toggle size="sm" pressed={editor.isActive("link")} onPressedChange={setLink} aria-label="Insert link">
          <LinkIcon className="h-3.5 w-3.5" />
        </Toggle>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 w-8 p-0"
          aria-label="Clear formatting"
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
        >
          <RemoveFormatting className="h-3.5 w-3.5" />
        </Button>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
