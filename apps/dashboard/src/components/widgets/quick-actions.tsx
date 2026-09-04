"use client";

import { Icons } from "@midday/ui/icons";
import { flushSync } from "react-dom";
import { useChatState } from "@/components/chat/chat-context";
import { useInboxUpload } from "@/hooks/use-inbox-upload";

const CHAT_ACTIONS = [
  {
    label: "Create Invoice",
    icon: Icons.Invoice,
    message: "Create a new invoice",
  },
  {
    label: "Add Transaction",
    icon: Icons.CreateTransaction,
    message: "Add a new transaction",
  },
  {
    label: "Add Customer",
    icon: Icons.Customers,
    message: "Add a new customer",
  },
  {
    label: "Track Time",
    icon: Icons.Tracker,
    message: "Start tracking time",
  },
] as const;

const buttonClassName =
  "group flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-2 text-xs font-medium text-muted-foreground shadow-sm transition-colors duration-150 hover:border-primary/25 hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const iconClassName =
  "text-muted-foreground group-hover:text-foreground transition-colors duration-150";

export function QuickActions({ onChatOpen }: { onChatOpen: () => void }) {
  const { sendMessage, setMessages, setChatTitle } = useChatState();
  const { openFilePicker } = useInboxUpload();

  const handleChatAction = (message: string) => {
    flushSync(() => {
      setMessages([]);
      setChatTitle(null);
    });
    sendMessage({ text: message });
    onChatOpen();
  };

  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-2 pt-3 pb-12">
      {CHAT_ACTIONS.map(({ label, icon: Icon, message }) => (
        <button
          key={label}
          type="button"
          data-track="Assistant Quick Action"
          data-action={label}
          className={buttonClassName}
          onClick={() => handleChatAction(message)}
        >
          <Icon size={13} className={iconClassName} />
          <span>{label}</span>
        </button>
      ))}

      <button
        type="button"
        data-track="Assistant Quick Action"
        data-action="Upload Receipt"
        className={buttonClassName}
        onClick={openFilePicker}
      >
        <Icons.Inbox2 size={13} className={iconClassName} />
        <span>Upload Receipt</span>
      </button>
    </div>
  );
}
