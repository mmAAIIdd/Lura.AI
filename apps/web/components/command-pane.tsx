"use client";

import { FormEvent, KeyboardEvent, useMemo, useRef, useState } from "react";

import { Markdown } from "@/components/markdown";
import {
  luraApi,
  type Conversation,
  type ConversationDetail,
  type Project,
  type RetrievedChunk,
  type User,
} from "@/lib/api";
import { SLASH_COMMANDS, type WorkspaceContext } from "@/lib/workspace-data";

type CommandPaneProps = {
  project: Project;
  user: User;
  initialConversations: Conversation[];
  initialConversation: ConversationDetail | null;
  context: WorkspaceContext;
  documentCount: number;
};

const FIRST_ENABLED = SLASH_COMMANDS.findIndex((command) => command.enabled);

export function CommandPane({
  project,
  user,
  initialConversations,
  initialConversation,
  context,
  documentCount,
}: CommandPaneProps) {
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [active, setActive] = useState<ConversationDetail | null>(initialConversation);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(Math.max(FIRST_ENABLED, 0));
  // Sources are returned per reply rather than stored, so they are kept against the message id.
  const [sourcesByMessage, setSourcesByMessage] = useState<Record<string, RetrievedChunk[]>>({});
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const enabledIndexes = useMemo(
    () => SLASH_COMMANDS.map((command, index) => (command.enabled ? index : -1)).filter((index) => index >= 0),
    [],
  );

  function openMenu() {
    setHighlighted(enabledIndexes[0] ?? 0);
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
    composerRef.current?.focus();
  }

  function applyCommand(index: number) {
    const command = SLASH_COMMANDS[index];
    if (!command?.enabled || !command.buildPrompt) return;
    setInput(command.buildPrompt(context));
    setMenuOpen(false);
    composerRef.current?.focus();
  }

  function moveHighlight(direction: 1 | -1) {
    const position = enabledIndexes.indexOf(highlighted);
    const next = enabledIndexes[(position + direction + enabledIndexes.length) % enabledIndexes.length];
    if (next !== undefined) setHighlighted(next);
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (menuOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveHighlight(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        applyCommand(highlighted);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        return;
      }
    }
    // "/" on an empty composer is the fast path into the command list.
    if (event.key === "/" && input.trim() === "") openMenu();
  }

  async function ensureConversation(): Promise<ConversationDetail> {
    if (active) return active;
    const created = await luraApi.createConversation(project.id);
    const detail: ConversationDetail = { ...created, messages: [] };
    setConversations((current) => [created, ...current]);
    setActive(detail);
    return detail;
  }

  async function selectConversation(conversationId: string) {
    setError(null);
    try {
      setActive(await luraApi.getConversation(conversationId));
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "Не удалось открыть беседу.");
    }
  }

  async function startConversation() {
    setError(null);
    try {
      const created = await luraApi.createConversation(project.id);
      setConversations((current) => [created, ...current]);
      setActive({ ...created, messages: [] });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Не удалось создать беседу.");
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content) return;
    setSending(true);
    setError(null);
    setInput("");
    try {
      const conversation = await ensureConversation();
      const reply = await luraApi.sendMessage(conversation.id, content);
      if (reply.sources?.length) {
        setSourcesByMessage((current) => ({ ...current, [reply.id]: reply.sources }));
      }
      const refreshed = await luraApi.getConversation(conversation.id);
      setActive(refreshed);
      setConversations((current) =>
        current.map((item) =>
          item.id === refreshed.id ? { ...item, title: refreshed.title, updated_at: refreshed.updated_at } : item,
        ),
      );
    } catch (sendError) {
      // The API stores the user message only after the provider replies, so on failure
      // nothing was saved — put the text back rather than losing it.
      setInput(content);
      setError(sendError instanceof Error ? sendError.message : "Не удалось отправить сообщение.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="command-pane" aria-label="Ассистент">
      <div className="ws-pane-head">
        <h2>Ассистент</h2>
        <button className="ws-button ws-button-quiet" onClick={() => void startConversation()}>
          Новый чат
        </button>
      </div>

      {conversations.length > 1 && (
        <div className="conversation-tabs" role="tablist" aria-label="Беседы">
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              role="tab"
              aria-selected={conversation.id === active?.id}
              className={conversation.id === active?.id ? "conversation-tab active" : "conversation-tab"}
              onClick={() => void selectConversation(conversation.id)}
            >
              {conversation.title}
            </button>
          ))}
        </div>
      )}

      <div className="message-list">
        {active?.messages.map((message) => {
          const sources = sourcesByMessage[message.id] ?? [];
          return (
            <article className={`message message-${message.role}`} key={message.id}>
              <span>{message.role === "assistant" ? project.ai_model.display_name : user.name}</span>
              {message.role === "assistant" ? <Markdown>{message.content}</Markdown> : <p>{message.content}</p>}
              {sources.length > 0 && (
                <details className="ws-sources-used">
                  <summary>Использованные источники: {sources.length}</summary>
                  {sources.map((source, index) => (
                    <div className="ws-source-ref" key={`${source.title}-${source.ordinal}-${index}`}>
                      <strong>{source.title}</strong>
                      <em>фрагмент {source.ordinal + 1} · {(source.score * 100).toFixed(0)}%</em>
                      <p>{source.content}</p>
                    </div>
                  ))}
                </details>
              )}
            </article>
          );
        })}
        {!active?.messages.length && (
          <div className="ws-chat-empty">
            <p>
              Нажмите <strong>/</strong> для готового разбора или задайте вопрос своими словами.
            </p>
            <p className="ws-hint">
              {documentCount > 0
                ? `Ассистент видит ${documentCount} загруженн${documentCount === 1 ? "ый источник" : "ых источника(ов)"} и подбирает релевантные фрагменты к каждому вопросу.`
                : "Загрузите данные слева — они попадут в контекст ассистента."}
            </p>
          </div>
        )}
      </div>

      {error && <p className="form-error" role="alert">{error}</p>}

      {menuOpen && (
        <ul className="command-menu" role="listbox" aria-label="Команды анализа">
          {SLASH_COMMANDS.map((command, index) => (
            <li
              key={command.slug}
              role="option"
              aria-selected={command.enabled && index === highlighted}
              aria-disabled={!command.enabled}
              className={
                !command.enabled
                  ? "command-item command-item-disabled"
                  : index === highlighted
                    ? "command-item active"
                    : "command-item"
              }
              onMouseEnter={() => command.enabled && setHighlighted(index)}
              onClick={() => applyCommand(index)}
            >
              <strong>{command.label}</strong>
              <small>{command.enabled ? command.description : `${command.description} — ${command.disabledReason}`}</small>
            </li>
          ))}
        </ul>
      )}

      <form className="chat-composer command-composer" onSubmit={send}>
        <button
          type="button"
          className={menuOpen ? "command-trigger active" : "command-trigger"}
          onClick={() => (menuOpen ? closeMenu() : openMenu())}
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-label="Команды анализа"
          title="Команды анализа"
        >
          /
        </button>
        <textarea
          ref={composerRef}
          aria-label="Сообщение"
          rows={3}
          maxLength={12000}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          placeholder="Нажмите / для команд или напишите вопрос"
        />
        <button className="ws-button ws-button-primary" disabled={sending || !input.trim()}>
          {sending ? "Думаю..." : "Отправить"}
        </button>
      </form>
    </section>
  );
}
