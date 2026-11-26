const headings = [
  ["What’s on your mind?", "Hvad har du på hjerte?"],
  ["Where should we begin?", "Hvor skal vi begynde?"],
  ["What shall we explore?", "Hvad skal vi udforske?"],
  ["What are you working on?", "Hvad arbejder du på?"],
  ["What would you like to make?", "Hvad vil du gerne skabe?"],
  ["What sparked your curiosity?", "Hvad gjorde dig nysgerrig?"],
  ["What’s your next idea?", "Hvad er din næste idé?"],
  ["Ready to try an idea?", "Klar til at prøve en idé af?"],
  ["What would you like to understand?", "Hvad vil du gerne forstå?"],
  ["What could work better?", "Hvad kunne fungere bedre?"],
  ["What are you figuring out?", "Hvad prøver du at finde ud af?"],
  ["Where are you stuck?", "Hvor sidder du fast?"],
  ["What needs a fresh look?", "Hvad vil du se med friske øjne?"],
  ["What would you like to learn?", "Hvad vil du gerne lære?"],
  ["What should we work through?", "Hvad skal vi gennemgå?"],
  ["What would you like to try?", "Hvad kunne du tænke dig at prøve?"],
  ["Have a question to start with?", "Har du et spørgsmål at begynde med?"],
  ["What could use a second opinion?", "Hvad vil du gerne have et andet blik på?"],
  ["What comes next?", "Hvad er næste skridt?"],
  ["What would make things clearer?", "Hvad vil du gerne have gjort tydeligere?"],
  ["What are you thinking about?", "Hvad går du og tænker på?"],
  ["What can we simplify?", "Hvad kan vi gøre enklere?"],
  ["What would you do differently?", "Hvad kunne du tænke dig at gøre anderledes?"],
  ["What deserves a closer look?", "Hvad fortjener et nærmere kig?"],
  ["What should we make sense of?", "Hvad skal vi prøve at forstå?"],
  ["What would help today?", "Hvad kunne hjælpe i dag?"],
  ["Which idea should we start with?", "Hvilken idé skal vi starte med?"],
  ["What’s worth trying?", "Hvad er værd at prøve?"],
  ["Want to explore a possibility?", "Vil du undersøge en mulighed?"],
  ["What would you like to improve?", "Hvad vil du gerne forbedre?"],
];

const subtitles = [
  ["Start with a question or a rough idea.", "Begynd med et spørgsmål eller en løs idé."],
  ["Bring a draft and work through it step by step.", "Start med et udkast, og arbejd videre trin for trin."],
  ["Ask for an example if you need one.", "Bed om et eksempel, hvis du har brug for det."],
  ["Break a big question into smaller ones.", "Del et stort spørgsmål op i mindre dele."],
  ["Tell Khat what you already know.", "Fortæl Khat, hvad du allerede ved."],
  ["Try putting the problem in your own words.", "Prøv at beskrive problemet med dine egne ord."],
  ["Bring a first draft, even if it’s unfinished.", "Start med et udkast, også selvom det er ufærdigt."],
  ["Explore two ways to approach the same problem.", "Undersøg to måder at gribe samme problem an på."],
  ["A few lines of context can help.", "Et par linjer om baggrunden kan hjælpe."],
  ["Start wherever it feels easiest.", "Begynd dér, hvor det føles lettest."],
  ["Ask for a short answer or a deeper explanation.", "Bed om et kort svar eller en grundigere forklaring."],
  ["Try a suggestion or write your own prompt.", "Prøv et forslag, eller skriv dit eget spørgsmål."],
  ["Bring a decision you want to think through.", "Fortæl om en beslutning, du vil tænke igennem."],
  ["Pick a topic and see where it leads.", "Vælg et emne, og se, hvor det fører hen."],
  ["You can refine the question as you go.", "Du kan justere spørgsmålet undervejs."],
  ["Try a different way of explaining it.", "Prøv at få det forklaret på en anden måde."],
  ["Start with the part that interests you most.", "Start med det, der interesserer dig mest."],
  ["Bring a plan and check what’s missing.", "Tag en plan med, og se, hvad der mangler."],
  ["Give an example of the result you want.", "Giv et eksempel på det resultat, du ønsker."],
  ["Look for a practical next step.", "Find et næste skridt, du kan bruge."],
  ["Try saying what you want to achieve.", "Prøv at beskrive, hvad du vil opnå."],
  ["Bring a detail you want to check.", "Tag en detalje med, som du vil undersøge."],
  ["Choose how much detail you need.", "Vælg, hvor mange detaljer du har brug for."],
  ["Share what you’ve tried so far.", "Fortæl, hvad du har prøvet indtil nu."],
  ["Start with a concrete example.", "Start med et konkret eksempel."],
];

const prompts = [
  [["Understand a topic", "Explain a topic using a concrete example: "], ["Forstå et emne", "Forklar et emne med et konkret eksempel: "]],
  [["Revise a draft", "Help me make this draft clearer without changing my tone: "], ["Gør et udkast skarpere", "Gør mit udkast tydeligere, og bevar min tone: "]],
  [["Debug some code", "Help me debug this code. Ask for the error and expected behavior if needed: "], ["Find en fejl i kode", "Hjælp mig med at finde fejlen. Spørg om fejlbeskeden og det forventede resultat, hvis det er nødvendigt: "]],
  [["Explore an idea", "Give me three distinct ways to develop this idea: "], ["Udforsk en idé", "Giv mig tre forskellige måder at arbejde videre med idéen på: "]],
  [["Review a design", "Review this design for clarity, accessibility, and visual hierarchy: "], ["Vurdér et design", "Vurdér designets tydelighed, tilgængelighed og visuelle hierarki: "]],
  [["Prioritize tasks", "Help me prioritize these tasks by urgency and impact: "], ["Prioritér opgaver", "Hjælp mig med at prioritere opgaverne efter hast og betydning: "]],
  [["Frame a research question", "Help me turn this topic into a specific research question: "], ["Find et undersøgelsesspørgsmål", "Hjælp mig med at gøre emnet til et konkret undersøgelsesspørgsmål: "]],
  [["Plan a project", "Help me outline a project with milestones, risks, and a first step: "], ["Planlæg et projekt", "Hjælp mig med en plan med milepæle, risici og et første skridt: "]],
  [["Think through a decision", "Compare the options and show what information would change the decision: "], ["Tænk en beslutning igennem", "Sammenlign mulighederne, og vis, hvad der kan ændre beslutningen: "]],
  [["Create an image", "Create an image of "], ["Lav et billede", "Lav et billede af "]],
];

const personalized = Symbol("personalized");
let previousHeading;
let previousSubtitle;
let previousPrompts = [];

function choose(items, previous) {
  const choices = items.filter(item => item !== previous);
  return choices[Math.floor(Math.random() * choices.length)];
}

export function welcomeCopy(language, name, date = new Date()) {
  const index = Number(language === "da");
  const hour = date.getHours();
  const greeting = hour < 12 ? ["Good morning", "Godmorgen"] : hour < 18 ? ["Good afternoon", "God eftermiddag"] : ["Good evening", "Godaften"];
  const candidate = name && previousHeading !== personalized && Math.random() < .25 ? personalized : choose(headings, previousHeading);
  previousHeading = candidate;
  const heading = candidate === personalized ? `${greeting[index]}, ${name}.` : previousHeading[index];
  previousSubtitle = choose(subtitles, previousSubtitle);
  const suggestions = [];
  while (suggestions.length < 3) {
    suggestions.push(choose(prompts.filter(item => !previousPrompts.includes(item) && !suggestions.includes(item))));
  }
  previousPrompts = suggestions;
  return { heading, subtitle: previousSubtitle[index], suggestions: suggestions.map(item => item[index]) };
}
