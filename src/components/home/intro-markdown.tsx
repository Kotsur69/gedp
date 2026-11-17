import type { ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import { ExternalLinkIcon } from "@/components/shell/icons";

// HR-edited markdown (HOME-11 intro text, HOME-01 start announcement), rendered on the server.
// The text is untrusted input, so:
// - raw HTML is dropped (skipHtml), never parsed;
// - only basic prose elements survive (plus headings when `headings` is set); anything else
//   (images, tables, headings by default) is unwrapped to text;
// - links keep only http(s) and mailto targets, others lose their href and render as plain text.

const ALLOWED_ELEMENTS = ["p", "br", "strong", "em", "ul", "ol", "li", "a", "blockquote"];
const HEADING_ELEMENTS = ["h1", "h2", "h3", "h4", "h5", "h6"];
const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** Returns the URL when its scheme is allowed, otherwise an empty string (link becomes text). */
export function safeIntroUrl(url: string): string {
  const trimmed = url.trim();
  return SAFE_URL.test(trimmed) ? trimmed : "";
}

interface IntroMarkdownProps {
  markdown: string;
  /** Screen-reader suffix for links that open in a new tab. */
  newTabLabel: string;
  /**
   * Keep HR headings, demoted to h3 (`#`, `##`) and h4 (deeper) so they nest under the h2 title of
   * the surrounding dialog or section.
   */
  headings?: boolean;
}

function Heading3({ children }: { children?: ReactNode }) {
  return <h3 className="text-lg font-semibold text-ink">{children}</h3>;
}

function Heading4({ children }: { children?: ReactNode }) {
  return <h4 className="font-semibold text-ink">{children}</h4>;
}

export function IntroMarkdown({ markdown, newTabLabel, headings = false }: IntroMarkdownProps) {
  const components: Components = {
    h1: Heading3,
    h2: Heading3,
    h3: Heading4,
    h4: Heading4,
    h5: Heading4,
    h6: Heading4,
    a: ({ href, children }) =>
      href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-baseline gap-0.5 font-semibold text-accent underline underline-offset-4 hover:no-underline focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {children}
          <ExternalLinkIcon className="size-3.5 shrink-0 self-center" />
          <span className="sr-only">{newTabLabel}</span>
        </a>
      ) : (
        <span>{children}</span>
      ),
  };

  return (
    <div className="max-w-3xl leading-relaxed text-ink-soft [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-4 [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_strong]:font-semibold [&_strong]:text-ink [&_ul]:list-disc [&_ul]:pl-5 [&>*+*]:mt-3">
      <Markdown
        skipHtml
        allowedElements={headings ? [...ALLOWED_ELEMENTS, ...HEADING_ELEMENTS] : ALLOWED_ELEMENTS}
        unwrapDisallowed
        urlTransform={safeIntroUrl}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
