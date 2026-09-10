"use client";

// AI Elements registry source, adapted to Blueprint's narrative-only use case.
// https://elements.ai-sdk.dev/components/message — docs/licenses/ai-elements-Apache-2.0.txt.
// Unused branching/actions and code/math/diagram plugins intentionally omitted.
import { cn } from "cn";
import { cjk } from "@streamdown/cjk";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";

export type MessageProps = HTMLAttributes<HTMLDivElement> & { from: "user" | "assistant" };
export const Message = ({ className, from, ...props }: MessageProps) => (
  <div className={cn("group flex w-full max-w-[95%] flex-col gap-2",
    from === "user" ? "is-user ml-auto justify-end" : "is-assistant", className)} {...props} />
);
export const MessageContent = ({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm", className)} {...props}>{children}</div>
);
const plugins = { cjk };
export type MessageResponseProps = ComponentProps<typeof Streamdown>;
export const MessageResponse = memo(({ className, ...props }: MessageResponseProps) => (
  <Streamdown className={cn("size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)} plugins={plugins} {...props} />
));
MessageResponse.displayName = "MessageResponse";
