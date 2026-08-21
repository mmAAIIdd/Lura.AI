import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';

export type FaqItem = { group: string; question: string; answer: string };

export const POPULAR_QUESTIONS: FaqItem[] = [
  {
    group: 'О платформе',
    question: 'Что именно делает Lura?',
    answer:
      'Lura анализирует последствия продуктовых изменений. Она знает, что вы изменили, наблюдает, что произошло после, связывает отзывы и метрики с релизом, проверяет несколько гипотез и только потом предлагает следующее действие.',
  },
  {
    group: 'О платформе',
    question: 'Чем это отличается от обычного чата с ИИ?',
    answer:
      'Чат — только интерфейс сверху. Ядро — аналитический pipeline и накопленный контекст продукта. Факты считаются по вашей базе детерминированно, а не придумываются моделью. Гипотезы всегда помечены как гипотезы и сопровождаются контраргументами.',
  },
  {
    group: 'О платформе',
    question: 'Lura доказывает причинно-следственную связь?',
    answer:
      'Нет, и это принципиально. Совпадение во времени показывается как корреляция, а не как доказанная причина. Для каждой гипотезы указывается уровень уверенности, что говорит против неё и каким экспериментом её проверить.',
  },
  {
    group: 'Данные',
    question: 'Какие данные нужны для старта?',
    answer:
      'Минимум — история релизов и обратная связь с датами. Полезно добавить продуктовые метрики по сегментам и периодам: без них нельзя сравнить состояние до и после изменения.',
  },
  {
    group: 'Данные',
    question: 'В каком виде загружать данные?',
    answer:
      'Текстовые форматы: txt, md, csv, json, log, yaml, xml. Можно просто вставить текст. Документ разбивается на фрагменты, индексируется и попадает в контекст ассистента — он отвечает со ссылкой на источник.',
  },
  {
    group: 'Данные',
    question: 'Что происходит с моими данными?',
    answer:
      'Данные принадлежат вашему рабочему пространству и изолированы по владельцу. Ключи провайдеров хранятся только на сервере и никогда не попадают в браузер. Сессии серверные, в HttpOnly cookie.',
  },
  {
    group: 'Работа',
    question: 'Как выглядит результат анализа?',
    answer:
      'Каждый вывод состоит из наблюдения, доказательств, затронутой области, влияния, уверенности, гипотез, контраргументов, рекомендации и способа проверки. Такой вывод можно перепроверить, а не принять на веру.',
  },
  {
    group: 'Работа',
    question: 'Нужно ли писать промпты?',
    answer:
      'Нет. В рабочем пространстве есть готовые команды по клавише «/»: разбор обратной связи, обзор обновлений и другие. Команда сама подставляет посчитанные цифры из вашей базы.',
  },
  {
    group: 'Подписка',
    question: 'Сколько стоит и есть ли бесплатный старт?',
    answer:
      'Начать можно бесплатно на одном рабочем пространстве: загрузка источников, разбор обратной связи и сравнение до/после доступны сразу. Платные планы снимают ограничения по объёму данных, истории и числу участников команды.',
  },
  {
    group: 'Подписка',
    question: 'Когда подписка окупается?',
    answer:
      'Когда команда перестаёт вручную перечитывать сотни отзывов после каждого релиза. Один вовремя пойманный откат метрики обычно стоит дороже годового плана.',
  },
];

type SearchOverlayProps = { open: boolean; onClose: () => void };

export function SearchOverlay({ open, onClose }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setExpanded(null);
      setActive(0);
      return;
    }
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(timer);
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return POPULAR_QUESTIONS;
    return POPULAR_QUESTIONS.filter(
      (item) =>
        item.question.toLowerCase().includes(needle) ||
        item.answer.toLowerCase().includes(needle) ||
        item.group.toLowerCase().includes(needle),
    );
  }, [query]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const groups = results.reduce<Record<string, FaqItem[]>>((accumulator, item) => {
    accumulator[item.group] = [...(accumulator[item.group] ?? []), item];
    return accumulator;
  }, {});

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (current + 1) % Math.max(results.length, 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => (current - 1 + results.length) % Math.max(results.length, 1));
      return;
    }
    if (event.key === 'Enter' && results[active]) {
      event.preventDefault();
      const question = results[active].question;
      setExpanded((current) => (current === question ? null : question));
    }
  }

  let flatIndex = -1;

  return (
    <div
      className="search-overlay"
      role="presentation"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="search-panel" role="dialog" aria-modal="true" aria-label="Вопросы о Lura" onKeyDown={handleKeyDown}>
        <div className="search-input-row">
          <Search className="h-[18px] w-[18px] text-[var(--muted-soft)]" />
          <input
            ref={inputRef}
            className="search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Найдите вопрос о Lura"
            aria-label="Поиск по вопросам"
          />
          <button className="gh-menu-button !grid !h-7 !w-7" onClick={onClose} aria-label="Закрыть вопросы">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="search-results">
          {results.length === 0 && (
            <p className="search-empty">
              Ничего не нашлось. Попробуйте «данные», «подписка» или «гипотеза».
            </p>
          )}
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <p className="search-group-title">{group}</p>
              {items.map((item) => {
                flatIndex += 1;
                const isActive = flatIndex === active;
                const isOpen = expanded === item.question;
                return (
                  <button
                    key={item.question}
                    className={isActive ? 'search-item search-item-active' : 'search-item'}
                    onClick={() => setExpanded(isOpen ? null : item.question)}
                    aria-expanded={isOpen}
                  >
                    <strong className="flex items-center justify-between gap-3">
                      {item.question}
                      <ChevronDown
                        className={`h-4 w-4 shrink-0 text-[var(--muted-soft)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                      />
                    </strong>
                    {isOpen && <p>{item.answer}</p>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
