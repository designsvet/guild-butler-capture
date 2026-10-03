import type { TLang } from "./i18n.js";
import { plural, type TPluralForms } from "./plural.js";

type TPveStrings = {
  thisSession: string;
  whereHappened: string;
  byContent: string;
  when: string;
  content: string;
  time: string;
  mobsKilled: string;
  totals: string;
  all: string;
  sort: string;
  kills: string;
  recent: string;
  last: string;
  standingOut: string;
  mostKilled: string;
  lastKill: string;
  sessionCurrencies: string;
  visitCurrencies: string;
  unplaced: string;
  recentChests: string;
  visits: (n: number) => string;
  kinds: (n: number) => string;
};
const counted =
  (lang: TLang, forms: TPluralForms) =>
  (n: number): string =>
    plural(lang, n, forms);

const CATALOG: Record<TLang, TPveStrings> = {
  en: {
    thisSession: "This session",
    whereHappened: "Where it happened",
    byContent: "By content · in the order you played",
    when: "When",
    content: "Content",
    time: "Time",
    mobsKilled: "Mobs killed",
    totals: "Totals",
    all: "All",
    sort: "Sort",
    kills: "Kills",
    recent: "Recent",
    last: "Last",
    standingOut: "Standing out",
    mostKilled: "Most killed",
    lastKill: "Last kill",
    sessionCurrencies: "Currencies for the whole session",
    visitCurrencies: "Fame and silver include all activities in each visit.",
    unplaced: "Visit time unknown",
    recentChests: "Most recent chests",
    visits: counted("en", { one: "# visit", other: "# visits" }),
    kinds: counted("en", { one: "# kind", other: "# kinds" }),
  },
  uk: {
    thisSession: "Ця сесія",
    whereHappened: "Де це сталося",
    byContent: "За контентом · у порядку відвідування",
    when: "Коли",
    content: "Контент",
    time: "Час",
    mobsKilled: "Убиті моби",
    totals: "Разом",
    all: "Усі",
    sort: "Сортування",
    kills: "Убивства",
    recent: "Останні",
    last: "Востаннє",
    standingOut: "Найпомітніше",
    mostKilled: "Найчастіше вбитий",
    lastKill: "Останнє вбивство",
    sessionCurrencies: "Валюти за всю сесію",
    visitCurrencies: "Слава та срібло охоплюють усі дії під час кожного відвідування.",
    unplaced: "Час відвідування невідомий",
    recentChests: "Останні скрині",
    visits: counted("uk", {
      one: "# відвідування",
      few: "# відвідування",
      many: "# відвідувань",
      other: "# відвідування",
    }),
    kinds: counted("uk", { one: "# вид", few: "# види", many: "# видів", other: "# виду" }),
  },
  ru: {
    thisSession: "Эта сессия",
    whereHappened: "Где это произошло",
    byContent: "По контенту · в порядке посещения",
    when: "Когда",
    content: "Контент",
    time: "Время",
    mobsKilled: "Убитые мобы",
    totals: "Всего",
    all: "Все",
    sort: "Сортировка",
    kills: "Убийства",
    recent: "Последние",
    last: "Последний",
    standingOut: "Особое",
    mostKilled: "Чаще всего убит",
    lastKill: "Последнее убийство",
    sessionCurrencies: "Валюты за всю сессию",
    visitCurrencies: "Слава и серебро включают все действия в каждом посещении.",
    unplaced: "Время посещения неизвестно",
    recentChests: "Последние сундуки",
    visits: counted("ru", { one: "# посещение", few: "# посещения", many: "# посещений", other: "# посещения" }),
    kinds: counted("ru", { one: "# вид", few: "# вида", many: "# видов", other: "# вида" }),
  },
  de: {
    thisSession: "Diese Sitzung",
    whereHappened: "Wo es geschah",
    byContent: "Nach Inhalt · in Spielreihenfolge",
    when: "Wann",
    content: "Inhalt",
    time: "Zeit",
    mobsKilled: "Getötete Mobs",
    totals: "Gesamt",
    all: "Alle",
    sort: "Sortieren",
    kills: "Kills",
    recent: "Zuletzt",
    last: "Letzter",
    standingOut: "Besonderes",
    mostKilled: "Am häufigsten getötet",
    lastKill: "Letzter Kill",
    sessionCurrencies: "Währungen der gesamten Sitzung",
    visitCurrencies: "Ruhm und Silber umfassen alle Aktivitäten jedes Besuchs.",
    unplaced: "Besuchszeit unbekannt",
    recentChests: "Neueste Truhen",
    visits: counted("de", { one: "# Besuch", other: "# Besuche" }),
    kinds: counted("de", { one: "# Art", other: "# Arten" }),
  },
  fr: {
    thisSession: "Cette session",
    whereHappened: "Où cela s’est passé",
    byContent: "Par contenu · dans l’ordre de jeu",
    when: "Quand",
    content: "Contenu",
    time: "Durée",
    mobsKilled: "Mobs tués",
    totals: "Total",
    all: "Tous",
    sort: "Trier",
    kills: "Victimes",
    recent: "Récent",
    last: "Dernier",
    standingOut: "Faits marquants",
    mostKilled: "Le plus tué",
    lastKill: "Dernière victime",
    sessionCurrencies: "Monnaies de toute la session",
    visitCurrencies: "La renommée et l’argent incluent toutes les activités de chaque visite.",
    unplaced: "Heure de visite inconnue",
    recentChests: "Coffres les plus récents",
    visits: counted("fr", { one: "# visite", other: "# visites" }),
    kinds: counted("fr", { one: "# type", other: "# types" }),
  },
  pt: {
    thisSession: "Esta sessão",
    whereHappened: "Onde aconteceu",
    byContent: "Por conteúdo · na ordem em que jogou",
    when: "Quando",
    content: "Conteúdo",
    time: "Tempo",
    mobsKilled: "Mobs mortos",
    totals: "Total",
    all: "Todos",
    sort: "Ordenar",
    kills: "Mortes",
    recent: "Recentes",
    last: "Último",
    standingOut: "Destaques",
    mostKilled: "Mais morto",
    lastKill: "Última morte",
    sessionCurrencies: "Moedas da sessão inteira",
    visitCurrencies: "Fama e prata incluem todas as atividades de cada visita.",
    unplaced: "Horário da visita desconhecido",
    recentChests: "Baús mais recentes",
    visits: counted("pt", { one: "# visita", other: "# visitas" }),
    kinds: counted("pt", { one: "# tipo", other: "# tipos" }),
  },
};

export const pveStrings = (lang: TLang): TPveStrings => CATALOG[lang];
