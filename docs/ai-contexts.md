# AI Contexts — Sprinto (v1.4.0)

Krátké souhrnné kontexty pro asistenty (AI) a automatizace při práci s tímto repozitářem.

## Účel
- Pomoci budoucím automatizovaným asistentům (CI, chatbots, review agents) rychle pochopit změny ve verzi v1.4.0.

## Hlavní změny (stručně)
- Feature: přidán klikací odkaz na externí Jira issue u aktivního issue (viz UI). Titul issue zůstává vizuálně nezměněný, místo toho je přidána malá ikonka pro otevření Jira.
- Fix: Filtrace účastníků podle práva `vote` — uživatelé bez práva `vote` se nyní nezobrazují jako karta v hlasování.
- Fix: Opravy layoutu / CSS pro Jira import panel — tlačítka již neroztahují panel a mají konzistentní velikost.
- Fix: Úprava pole `Round` (Avg / Median / ...) — zmenšen prostor pro název, povoleno zalamování souhrnu, aby statistiky byly čitelné.

## Kde hledat změny v kódu
- Server: `app/src/store.js` — agregace `permission_codes` a výpočet `canVote` z mapovaných práv.
- Frontend:
  - `app/web/src/components/RoomView.tsx` — přidání `openExternalUrl()` helperu, použití `LinkIcon` v `issue-banner`, keyboard accessibility, vykreslení Jira import/send panelech.
  - `app/web/src/styles.css` — změny rozložení `.issue-banner`, `.queue-item__icon` (cursor), `.jira-import-actions` a `.round-inline` (šířky / zalamování).

## Ověření / checklist pro AI testy
- Otevřít místní build a zkontrolovat:
  - Aktivní issue má vedle názvu malou ikonku, která v novém okně otevře `externalIssueUrl`.
  - Uživatel, který nemá právo `vote` se nezobrazuje mezi hráči.
  - V importním modalu (`Import from Jira`) jsou tlačítka menší a zarovnaná, nezpůsobují roztažení panelu.
  - Pole `Round` zobrazuje čitelné hodnoty Avg/Median (zalomení nebo zkrácení podle šířky).

## Poznámky
- Tyto kontexty slouží jako rychlá nápověda pro agenty; obsah upravuj při dalších UI/back-end změnách.

## Nové kontexty (v1.4.1)

- Fix: Timeline density — události v historii a v PDF reportech se nyní rozkládají rovnoměrně mezi `Start` a `Reveal`, aby se předešlo hromadění hlasovacích bodů v jednom místě. To zlepšuje čitelnost větších kol, kde většina účastníků hlasuje téměř současně.
- Implementováno ve frontendu: `app/web/src/components/RoomView.tsx` (funkce `buildTimelineLayout` — pozice událostí nyní používá indexové rozložení pro vizuální přehlednost).
- Implementováno v PDF exportu: `app/src/jira.js` (funkce `buildPdfTimelineLayout` — pozice markerů pro PDF je nyní rovnoměrně rozmístěna po stopě).
- Poznámka pro agenty: i když jsou události vizuálně rozložené, sekvenční pořadí událostí zůstává chronologické; pokud je potřeba zachovat časový poměr, zvažte přidání přepínače `preserveTimestamps`.

### Ověření
- Otevřít místní vývojový build a spustit pár historických reportů s hustými hlasovacími koly. Zkontrolovat, že body nejsou přilepené na začátku nebo konci, ale rovnoměrně rozprostřené mezi `Start` a `Reveal`.
- Zkontrolovat PDF export přes `Send to Jira` a ověřit, že timeline v připojeném PDF odpovídá vizuálnímu rozložení v UI.

Tyto kontexty přidejte do tréninkových promptů nebo CI kontrol, které generují automatické changelogy nebo vědomostní bází pro asistenty.
