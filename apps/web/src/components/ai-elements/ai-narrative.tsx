"use client";
import { MessageResponse } from "./message";

const allowedElements = ["p", "strong", "em", "ul", "ol", "li", "blockquote", "code", "br", "del"];
const noUrl = () => null;
const semanticElements = { strong: "strong", em: "em" } as const;

/** Model prose is readable, not a source of navigation, remote media or HTML. */
export function AiNarrative({ children }: { children: string }) {
  return <MessageResponse mode="static" isAnimating={false} controls={false} parseIncompleteMarkdown={false}
    allowedElements={allowedElements} unwrapDisallowed skipHtml urlTransform={noUrl} components={semanticElements}
    className="clarification-narrative">{children}</MessageResponse>;
}
