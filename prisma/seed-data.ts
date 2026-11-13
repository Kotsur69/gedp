// Static reference data for prisma/seed.ts. SYNTHETIC / PLACEHOLDER content only (plan section 6).
// Group goal texts are the eGEDP 2026 texts quoted in
// "Historia wersji oraz md/Wymagania/03_Cz1_Cele_Grupy.md"; HR confirms the 2027 version (Q-07).

import type { GroupGoalType } from "../src/generated/prisma/client";

export const PLACEHOLDER_PL = "[PLACEHOLDER - tekst eGEDP 2026, do potwierdzenia przez HR (Q-07)]";
export const PLACEHOLDER_EN = "[PLACEHOLDER - eGEDP 2026 text, to be confirmed by HR (Q-07)]";
export const TO_BE_DIRECTED = "(to be directed)";

const LEADERSHIP_PL = `Wzmacniamy kulturę opartą na wynikach w ArcelorMittal, tworząc, pielęgnując i utrzymując różnorodną i inkluzywną kulturę, w której cenimy i rozwijamy pracowników o każdym pochodzeniu i doświadczeniach, niezależnie od rasy, płci i orientacji, tak aby każdy czuł się zachęcony i zmotywowany do jak najlepszego wkładu w realizację naszych celów strategicznych.
Ponieważ wszyscy jesteśmy liderami w swoich dziedzinach, to odpowiedzialność każdego z nas jest działać i realizować, wzmacniając naszych kolegów i zespoły do działania; zaufać im, że podejmą właściwe decyzje; i rozliczać ich z realizacji usług.
- Stawiać na pierwszym miejscu zdrowie i bezpieczeństwo oraz dobrostan wszystkich oraz dawać przykład, dbając o siebie i innych w sposób wzajemnej zależności
- Ustalić jasne kierunki i ambitne cele dla siebie i osób wokół nas, zgodnie z kulturą zarządzania wynikami i procesem GEDP
- Zapewniać inspirujące i skuteczne przywództwo oraz wsparcie oraz promować różnorodną, inkluzywną kulturę i przejrzystą komunikację w każdej sytuacji
- Doceniaj wysiłki ludzi i nagradzaj znaczący wkład
- Szukać i zapewniać możliwości nauki i rozwoju, dla siebie i innych
- Ustanawianie i integracja kultury etyki, uczciwości i uczciwości, zgodnie z programem zgodności Grupy
- Demonstruj i promuj wzorowe zachowania, zarówno w firmie, jak i we wszystkich kontaktach z interesariuszami`;

// Only the beginning of the EN text is visible on the 2026 screenshot (IMG9).
const LEADERSHIP_EN = `Strengthen the performance driven culture in ArcelorMittal, by creating, nurturing and sustaining a diverse and inclusive culture where we value and develop employees of all backgrounds and experiences across race, … (rest of the text not available - to be provided by HR)`;

// Only the beginning of the PL text is visible on the 2026 screenshot (IMG3).
const VALUES_PL = `1 Bezpieczeństwo - Konsekwentnie przestrzega protokołów bezpieczeństwa, proaktywnie identyfikuje i łagodzi potencjalne zagrożenia, aktywnie promuje kulturę bezpieczeństwa i dobrostanu… (pozostała część tekstu do uzupełnienia przez HR)`;

const VALUES_EN = `1 Safety - Consistently adheres to safety protocols, proactively identifies and mitigates potential hazards, actively promotes safety and wellbeing culture
2 Quality - Delivers work of exceptional quality with minimal errors, seeks continuous improvement and encourages quality standards among peers
3 Sustainability - Actively seeks sustainable practices, minimizes waste and promotes sustainable initiatives.
4 Leadership - Acts in alignment with a culture of ethics, honesty and integrity, effectively drives team/process performance, inspires and motivates others to deliver organizational goals`;

// No PL text exists in the source material; HR provides the translation.
const BHP_PL = `Believe in Zero - każdy pracownik musi ustalić jedno osobiste zobowiązanie BHP na rok. (pełny tekst PL i lista przykładów do przygotowania przez HR)`;

const BHP_EN = `To support our journey to zero accidents and fatalities and to prioritize wellbeing, every employee must set one health and safety personal commitment for the year.
Feel free to take inspiration in following examples
- Consider health and safety (H&S) in all projects and initiatives, interactions with contractors and suppliers, and/or negotiations affecting ArcelorMittal's operations.
- Speak up if feeling unwell, stressed, or under pressure, and remain vigilant for colleagues' well-being and potential hazards.
- I will actively observe my surroundings and be vigilant for any potential hazards that could affect my colleagues.
- Identify vehicle hazards, wear a seatbelt, ensure visibility, check the parking brake, and maintain pedestrian-vehicle separation.
- Report damaged or malfunctioning safety devices; if overriding, obtain written approval from the leader and conduct a risk analysis.
- Follow all risk controls outlined in the job risk analysis and Standard Operating Practices, obtaining work permits as required.
- Prioritize mental health by taking regular breaks and seeking support when needed.
- Incorporate physical activity into daily routines.
- Care for colleagues' safety and immediately report unsafe behavior or conditions, encouraging others to do the same.`;

export const GROUP_GOAL_TEMPLATES: ReadonlyArray<{
  type: GroupGoalType;
  sortOrder: number;
  contentPl: string;
  contentEn: string;
}> = [
  { type: "PRZYWODZTWO", sortOrder: 1, contentPl: `${PLACEHOLDER_PL}\n${LEADERSHIP_PL}`, contentEn: `${PLACEHOLDER_EN}\n${LEADERSHIP_EN}` },
  { type: "WARTOSCI", sortOrder: 2, contentPl: `${PLACEHOLDER_PL}\n${VALUES_PL}`, contentEn: `${PLACEHOLDER_EN}\n${VALUES_EN}` },
  { type: "BHP", sortOrder: 3, contentPl: `${PLACEHOLDER_PL}\n${BHP_PL}`, contentEn: `${PLACEHOLDER_EN}\n${BHP_EN}` },
];

// TargetType has no sort column: rows are created in this order, so ids follow it on a fresh database.
export const TARGET_TYPES = [
  { code: "LICZBA", namePl: "Liczba", nameEn: "Number", isNumeric: true },
  { code: "TEKST", namePl: "Tekst", nameEn: "Text", isNumeric: false },
  { code: "PROCENT", namePl: "Procent", nameEn: "Percent", isNumeric: true },
  { code: "TONY", namePl: "Tony", nameEn: "Tons", isNumeric: true },
  { code: "EURO", namePl: "Euro", nameEn: "Euro", isNumeric: true },
  { code: "USD", namePl: "Dolar USD", nameEn: "US Dollar", isNumeric: true },
] as const;

// Placeholder competency catalogue until HR delivers the real one.
export const COMPETENCIES = [
  { namePl: "Odwaga do kwestionowania", nameEn: "Courage to Challenge" },
  { namePl: "Innowacyjność", nameEn: "Innovation" },
  { namePl: "Rozwijanie kultury bezpieczeństwa", nameEn: "Advance Safety Culture" },
  { namePl: "Kompetencje funkcjonalne BHP", nameEn: "H&S Functional Capabilities" },
] as const;

export const DEVELOPMENT_AREAS = [{ namePl: "Obecna rola", nameEn: "Current role" }] as const;

export const CONTENT_BLOCK_KEYS = ["KOMUNIKAT_STARTOWY", "TEKST_POWITALNY"] as const;

export const FIRST_NAMES = [
  "Anna", "Piotr", "Katarzyna", "Tomasz", "Magdalena", "Paweł", "Agnieszka", "Michał", "Joanna", "Krzysztof",
  "Ewa", "Marcin", "Monika", "Łukasz", "Barbara", "Jakub", "Aleksandra", "Grzegorz", "Natalia", "Adam",
] as const;

export const LAST_NAMES = [
  "Nowak", "Kowalczyk", "Wiśniewski", "Wójcik", "Kamiński", "Lewandowski", "Zieliński", "Szymański", "Woźniak", "Dąbrowski",
  "Kozłowski", "Jankowski", "Mazur", "Krawczyk", "Piotrowski", "Grabowski", "Pawlak", "Michalski", "Król", "Wieczorek",
] as const;

export const DEPARTMENTS = ["Produkcja", "Utrzymanie ruchu", "Finanse", "HR", "Logistyka"] as const;
export const LOCATIONS = ["Kraków", "Dąbrowa Górnicza", "Sosnowiec", "Świętochłowice"] as const;

// Synthetic 2026 performance goals used for the "copy from previous year" scenario.
export const SAMPLE_PERFORMANCE_GOALS = [
  { title: "Obniżenie zużycia energii na linii", measures: "Zużycie MWh na tonę", targetCode: "PROCENT", targetValue: "5" },
  { title: "Zwiększenie produkcji wyrobów płaskich", measures: "Tony w roku", targetCode: "TONY", targetValue: "12000" },
  { title: "Ograniczenie kosztów utrzymania", measures: "Oszczędność w EUR", targetCode: "EURO", targetValue: "50000" },
  { title: "Wdrożenie nowej procedury odbioru", measures: "Procedura zatwierdzona", targetCode: "TEKST", targetValue: "Procedura opublikowana w systemie" },
  { title: "Skrócenie przestojów nieplanowanych", measures: "Liczba godzin przestoju", targetCode: "LICZBA", targetValue: "120" },
  { title: "Rozliczenie projektu inwestycyjnego", measures: "Budżet w USD", targetCode: "USD", targetValue: "200000" },
] as const;
