"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  IconArrowUp,
  IconPlus,
  IconMicrophone,
  IconVolume,
  IconPlayerStop,
  IconLoader2,
  IconCheck,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useThreadMessages, useSendMessage, useCreateThread } from "@/hooks/use-convex-data";

/**
 * AIChat panel — wired to Convex Agent via useThreadMessages and useSendMessage.
 *
 * Props:
 * - threadId: optional initial thread ID. If null, a new thread is created on first message.
 * - projectId / userId: needed for auto-thread-creation.
 *
 * Messages come from @convex-dev/agent's UIMessage format with typed `parts[]`.
 * Streaming results have status "streaming" and their text parts update in real-time.
 * Tool calls appear as parts with type "tool-invocation".
 */

export function AIChat({ threadId: initialThreadId, projectId, userId }: {
  threadId: string | null;
  projectId?: string;
  userId?: string;
}) {
  const [activeThreadId, setActiveThreadId] = useState<string | null>(initialThreadId);
  const threadId = activeThreadId;
  const { results, status, loadMore } = useThreadMessages(threadId);
  const sendMessage = useSendMessage();
  const createThread = useCreateThread();
  const [inputValue, setInputValue] = useState("");
  const [inputActive, setInputActive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Check if any message is currently streaming
  const isStreaming = results?.some((msg) => msg.status === "streaming") ?? false;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [results, isStreaming]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text) return;

    let tid = threadId;
    if (!tid && projectId && userId) {
      const result = await createThread({ projectId: projectId as any, userId: userId as any });
      tid = result.threadId;
      setActiveThreadId(tid);
    }
    if (!tid) return;

    sendMessage({ threadId: tid, prompt: text });
    setInputValue("");
  }, [inputValue, threadId, projectId, userId, sendMessage, createThread]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const activateInput = () => {
    setInputActive(true);
    setTimeout(() => inputRef.current?.focus(), 250);
  };

  const handleBlur = () => {
    if (!inputValue) setInputActive(false);
  };

  return (
    <div className="flex h-full flex-col bg-bg-card">
      {/* Sub-bar */}
      <div className="flex h-[36px] shrink-0 items-center justify-between px-4">
        <span className="text-[13px] font-medium text-text-secondary">Chat</span>
        {isStreaming && (
          <span className="text-[12px] text-accent">Streaming...</span>
        )}
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-5 pb-4">
          {!threadId && (
            <div className="flex items-center justify-center py-12 text-[14px] text-text-muted">
              Send a message to start a new conversation.
            </div>
          )}
          {results?.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {isStreaming && results?.[results.length - 1]?.role !== "assistant" && (
            <TypingIndicator />
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input bar */}
      <div className="px-4 pb-4">
        <div
          className={cn(
            "relative overflow-hidden rounded-3xl border border-border bg-bg-card transition-all duration-300",
            isStreaming && "border-accent/20",
          )}
        >
          {/* Textarea - animated expand/collapse */}
          <div className={cn(
            "grid transition-all duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
            inputActive ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          )}>
            <div className={cn(
              "min-h-0 overflow-hidden transition-opacity",
              inputActive
                ? "opacity-100 delay-200 duration-150"
                : "opacity-0 duration-100"
            )}>
              <div className="px-5 pt-4 pb-1">
                <textarea
                  ref={inputRef}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onBlur={handleBlur}
                  rows={1}
                  disabled={!threadId && !projectId}
                  className="w-full max-h-[120px] resize-none bg-transparent text-[15px] leading-snug text-text-primary outline-none [field-sizing:content] placeholder:text-text-muted disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="flex items-center px-3 py-2.5">
            {/* Left - attach */}
            <ChatBarButton icon={IconPlus} label="Upload file" />

            {/* Center - placeholder or spacer */}
            {!inputActive ? (
              <button
                onClick={activateInput}
                className="mr-3 flex h-9 flex-1 cursor-text items-center rounded-full px-4 transition-colors hover:bg-bg-muted"
              >
                <span className="text-[15px] leading-none text-text-muted">Ask anything...</span>
              </button>
            ) : (
              <div className="flex-1" />
            )}

            {/* Right - voice controls + send */}
            <ChatBarButton icon={IconVolume} label="Speaker" />
            <ChatBarButton icon={IconMicrophone} label="Voice input" />
            <ChatBarButton
              icon={IconArrowUp}
              label="Send message"
              onClick={handleSend}
              variant={inputValue.trim() && threadId ? "active" : "muted"}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Icon button for the chat bar - 3 variants matching Looped's ChatBarIconButton */
function ChatBarButton({ icon: Icon, label, onClick, variant = "ghost" }: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick?: () => void;
  variant?: "ghost" | "active" | "muted";
}) {
  const variantClasses = {
    ghost: "text-text-muted hover:bg-bg-muted hover:text-text-secondary",
    active: "text-white before:absolute before:inset-0 before:rounded-full before:bg-text-primary before:-z-10 before:transition-colors hover:before:bg-text-secondary",
    muted: "text-text-muted before:absolute before:inset-0 before:rounded-full before:bg-bg-muted before:-z-10",
  };

  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "relative isolate mr-1 flex h-9 w-9 items-center justify-center rounded-full transition-colors duration-300 ease-in-out",
        variantClasses[variant],
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

/**
 * UIMessage from @convex-dev/agent has:
 * - id: string
 * - role: "user" | "assistant"
 * - status: "pending" | "streaming" | "complete" | "error"
 * - parts: Array<{ type: "text", text: string } | { type: "tool-invocation", toolInvocation: {...} } | ...>
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function MessageBubble({ message }: { message: any }) {
  const isUser = message.role === "user";
  const isMessageStreaming = message.status === "streaming";

  // Extract text content from parts
  const textContent = message.parts
    ?.filter((part: { type: string }) => part.type === "text")
    .map((part: { text: string }) => part.text)
    .join("") ?? "";

  // Extract tool invocations from parts
  const toolParts = message.parts?.filter(
    (part: { type: string }) => part.type === "tool-invocation"
  ) ?? [];

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      {isUser ? (
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-border bg-bg-muted px-4 py-2.5 text-[14px] leading-relaxed text-text-primary">
          <p className="whitespace-pre-wrap">{textContent}</p>
        </div>
      ) : (
        <div className="w-full text-[14px] leading-[1.6] text-text-primary">
          {/* Tool call indicators */}
          {toolParts.length > 0 && (
            <div className="mb-2 flex flex-col gap-1.5">
              {toolParts.map((part: { toolInvocation: { toolCallId: string; toolName: string; state: string } }, i: number) => (
                <ToolCallIndicator key={part.toolInvocation.toolCallId ?? i} toolInvocation={part.toolInvocation} />
              ))}
            </div>
          )}

          {/* Text content */}
          {textContent && (
            <div className={cn("[&_strong]:font-semibold", isMessageStreaming && "animate-pulse")}>
              <MessageContent content={textContent} />
            </div>
          )}

          {/* Streaming cursor */}
          {isMessageStreaming && !textContent && (
            <TypingIndicator />
          )}
        </div>
      )}
    </div>
  );
}

/** Shows tool call status: running spinner or complete checkmark */
function ToolCallIndicator({ toolInvocation }: {
  toolInvocation: { toolName: string; state: string };
}) {
  const isComplete = toolInvocation.state === "result";
  const isError = toolInvocation.state === "error";

  return (
    <div className={cn(
      "inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] font-medium",
      isComplete
        ? "bg-accent-muted text-accent"
        : isError
          ? "bg-red-500/10 text-red-400"
          : "bg-bg-muted text-text-secondary",
    )}>
      {isComplete ? (
        <IconCheck className="h-3.5 w-3.5" />
      ) : isError ? (
        <span className="text-red-400">!</span>
      ) : (
        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
      )}
      <span>{toolInvocation.toolName}</span>
      <span className="text-text-muted">
        {isComplete ? "Complete" : isError ? "Error" : "Running..."}
      </span>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start">
      <div className="flex gap-1.5 rounded-2xl rounded-tl-sm border border-border bg-bg-muted px-4 py-3">
        <div className="size-1.5 animate-pulse rounded-full bg-text-muted" />
        <div className="size-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:150ms]" />
        <div className="size-1.5 animate-pulse rounded-full bg-text-muted [animation-delay:300ms]" />
      </div>
    </div>
  );
}

function MessageContent({ content }: { content: string }) {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
        return part.split("\n").map((line, j) => (
          <span key={`${i}-${j}`}>{j > 0 && <br />}{line}</span>
        ));
      })}
    </>
  );
}
