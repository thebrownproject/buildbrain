"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  IconArrowUp,
  IconPlus,
  IconMicrophone,
  IconVolume,
  IconPlayerStop,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  extractedData?: boolean;
};

const INITIAL_MESSAGES: Message[] = [
  { id: "1", role: "assistant", content: "I've loaded **clinic-project.ifc** with 847 elements across 2 storeys. What would you like to know about this model?", timestamp: new Date(Date.now() - 120000) },
  { id: "2", role: "user", content: "Show me all fire-rated doors", timestamp: new Date(Date.now() - 90000) },
  { id: "3", role: "assistant", content: "Found **12 fire-rated doors** across both levels. 8 on Ground Floor (FRL-60) and 4 on Level 1 (FRL-30). I've sent the full breakdown to the data panel.", timestamp: new Date(Date.now() - 60000), extractedData: true },
  { id: "4", role: "user", content: "What about the windows on level 2? Any missing thermal data?", timestamp: new Date(Date.now() - 30000) },
  { id: "5", role: "assistant", content: "Level 2 has **44 windows** (335.9 m\u00b2 total). All are external, mostly fixed type 1220x1500mm.\n\n**Issue:** No U-Value or acoustic ratings are present on any window. The fire rating field contains placeholder values only. This should be flagged for the design team.", timestamp: new Date(Date.now() - 10000), extractedData: true },
];

function formatTime(ts: Date) {
  return ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function AIChat() {
  const [messages, setMessages] = useState<Message[]>(INITIAL_MESSAGES);
  const [inputValue, setInputValue] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [inputActive, setInputActive] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", content: text, timestamp: new Date() }]);
    setInputValue("");
    setIsStreaming(true);
    setTimeout(() => {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: "Processing your request against the IFC model. This is a prototype -- in production, BuildBrain's extraction tools would handle this query.", timestamp: new Date() }]);
      setIsStreaming(false);
    }, 1500);
  }, [inputValue]);

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
      <div className="flex h-[36px] shrink-0 items-center justify-between border-b border-border px-4">
        <span className="text-[13px] font-medium text-text-secondary">Chat</span>
        <span className="text-[12px] text-text-muted">clinic-project.ifc</span>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-4 p-5 pb-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {isStreaming && messages[messages.length - 1]?.role !== "assistant" && (
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
                  className="w-full max-h-[120px] resize-none bg-transparent text-[15px] leading-snug text-text-primary outline-none [field-sizing:content] placeholder:text-text-muted"
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
              variant={inputValue.trim() ? "active" : "muted"}
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

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      {isUser ? (
        <div className="max-w-[85%] rounded-2xl rounded-tr-sm border border-border bg-bg-muted px-4 py-2.5 text-[14px] leading-relaxed text-text-primary">
          <p className="whitespace-pre-wrap">{message.content}</p>
        </div>
      ) : (
        <div className="w-full text-[14px] leading-[1.6] text-text-primary">
          {message.extractedData && (
            <span className="mb-1.5 inline-block rounded-full bg-accent-muted px-2.5 py-0.5 text-[12px] font-medium text-accent">
              Data extracted
            </span>
          )}
          <div className="[&_strong]:font-semibold">
            <MessageContent content={message.content} />
          </div>
        </div>
      )}
      <span className="mt-1.5 px-1 text-[11px] text-text-muted">{formatTime(message.timestamp)}</span>
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
