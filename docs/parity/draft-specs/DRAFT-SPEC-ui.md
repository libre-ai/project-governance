# DRAFT SPEC: `@libre-ai/ui` — Layer 4 Accessible UI Primitives

**Version**: 0.1.0-draft  
**Status**: Benchmark alignment audit  
**Date**: 2026-07-22

---

## Propósito

Fournir une fondation accessible et vérifiable pour les applications React souveraines, basée sur les hooks `react-aria-components` d'Adobe et les CSS tokens locaux. Brick layer-4 qui expose des primitives non-stylisées (boutons, surfaces, skip links, messages de statut) avec focus visible, motions réduites et schémas de couleurs forcées comme invariants CSS.

---

## Périmètre et Surface

**Surface actuelle** (v0.1.0):

- `ActionButton` (Aria Button wrapper, tonalités primary/quiet)
- `SkipLink` (accès rapide au contenu, toujours visible en focus)
- `Surface` (conteneur section/article avec classe sémantique)
- `StatusMessage` (annonces aria-live, politeness polite/assertive)
- Feuille CSS locale (`styles.css`, layer-based architecture)
- Adapteur Tailwind (bounded compiler, allow-list déterministe)

**Token System**:

- 24 CSS vars (couleurs, espaces, rayons, ombres, mesures)
- Dark mode automatique (`prefers-color-scheme: dark`)
- Light/dark palette alignée WCAG AA
- Pas de fonte, icône ni ressource distante

---

## Capacités Actuelles

### Primitives Composants

- **ActionButton**: hérite react-aria Button (keyboard/screen-reader ready, tone variants)
- **SkipLink**: navigation clavier au contenu principal, texte par défaut FR « Aller au contenu »
- **Surface**: sémantique HTML (article/section) avec classe `.lai-surface`
- **StatusMessage**: aria-live/role status, utile pour notifications ARIA

### Système de Tokens

- Palette couleurs (canvas, surface, ink, muted, border, accent, focus)
- Spacing scale (1, 2, 3, 4, 6, 8, 12 rem units)
- Typographie (serif system sans-serif, line-height 1.5)
- Rayons (sm 0.35rem, md 0.75rem)
- Ombres (light/dark adaptatif)

### Accessibilité CSS

- Focus visible (outline 0.2rem solid, offset 0.2rem)
- Reduced motion (`prefers-reduced-motion: reduce`)
- Forced color (`forced-color` media query ready)
- Dark color-scheme native

### Théming & Adaptation

- Tailwind bounded adapter (émet uniquement les utilities référencés)
- Pas de font/script externe
- Reset CSS minimalist (box-sizing, scroll-behavior, margins)

---

## Non-objectifs

**Hors périmètre volontaire**:

- **Composants stylisés**: shadcn/ui offre une collection opinionated; nous exécutons la couche d'accessibilité brute
- **Telémétrie / cloud**: zéro appel d'origine distante
- **Framework-agnostic**: React seul; `react-aria-components` impose une dépendance React
- **Icônes / fonte distantes**: toute ressource critique doit être embarquée ou gérée par le consommateur
- **Composants complexes**: tables, forms élaborées, dialogs multi-étapes restent au niveau consommateur (se composent sur la base)
- **Thème global forcé**: respecte `color-scheme`, réagit aux préférences; n'impose pas une tonalité

---

## Surface Contrats / API

### Exports Principaux

```typescript
export interface ActionButtonProps extends Omit<AriaButtonProps, "className"> {
  className?: string;
  tone?: "primary" | "quiet";
}
export function ActionButton(props: ActionButtonProps): JSX.Element;

export interface SkipLinkProps {
  children?: ReactNode;
  targetId: string;
}
export function SkipLink(props: SkipLinkProps): JSX.Element;

export interface SurfaceProps extends PropsWithChildren<
  HTMLAttributes<HTMLElement>
> {
  as?: "article" | "section";
}
export function Surface(props: SurfaceProps): JSX.Element;

export interface StatusMessageProps extends HTMLAttributes<HTMLParagraphElement> {
  politeness?: "polite" | "assertive";
}
export function StatusMessage(props: StatusMessageProps): JSX.Element;
```

### Feuille CSS

- Export direct: `@libre-ai/ui/styles.css`
- Import une fois par application
- Layered architecture: reset → tokens → base → components → utilities

### Adapteur Tailwind

- Export: `@libre-ai/ui/tailwind`
- Compiler déterministe (allow-list des classes référencées)
- Pas de jit runtime; compilation build-time

---

## Posture Accessibilité & Sécurité

### Accessibilité

- **WAI-ARIA Patterns**: react-aria implémente les pratiques de rédaction WAI-ARIA (keyboard nav, focus mgmt, aria attributes)
- **Keyboard Navigation**: tous les composants répondent aux touches (Enter, Space, Escape, arrows)
- **Screen Reader**: aria-live, role status, aria-label auto-déduits par react-aria
- **Reduced Motion**: animations CSS proscrites ; transitions doivent respecter `prefers-reduced-motion: reduce`
- **Dark Mode**: paire couleur light/dark automatique, contraste WCAG AA+

### Sécurité

- **Pas de XSS a priori**: React échappement natif, pas d'innerHTML
- **CSP-friendly**: pas de script inline dynamique, styles locaux uniquement
- **Audit**: Playwright evidence (SSR, hydration, no-JS fallback, PWA offline)

---

## Tableau de Parité Benchmark

| Benchmark            | Radix UI / shadcn/ui    | React Aria         | MUI             | Couverture Actuelle        | T1 Prioritaire                                    | Arbitrage                          |
| -------------------- | ----------------------- | ------------------ | --------------- | -------------------------- | ------------------------------------------------- | ---------------------------------- |
| **Boutons**          | ✓ (Button + variants)   | ✓ Hooks            | ✓ Button        | ✓ ActionButton 2 tonalités | Variants supplémentaires (ghost, danger), size XL | Non-but: pas de button group       |
| **Inputs texte**     | ✓ (TextField)           | ✓ Hooks            | ✓ TextField     | ✗ Absent                   | TextField, Checkbox, Radio (Aria hooks)           | Gérés par consommateur             |
| **Dialogs**          | ✓ (Dialog, AlertDialog) | ✓ Hooks            | ✓ Dialog        | ✗ Absent                   | Dialog/Modal composable (Aria Dialog + Surface)   | T1 optionnel si priorité UX        |
| **Menus / Popovers** | ✓ (Menu, Popover)       | ✓ Hooks            | ✓ Menu          | ✗ Absent                   | Popover (trigger + offset), Dropdown Menu         | T1 optionnel (complexité)          |
| **Tabs**             | ✓ (Tabs)                | ✓ Hooks            | ✓ Tabs          | ✗ Absent                   | Tabs composable (Aria Tabs)                       | T1 optionnel                       |
| **Tables**           | ✓ (Table)               | ✓ Hooks            | ✓ Table         | ✗ Absent                   | Table row selection, sorting, pagination          | Complexité; gérées au niveau app   |
| **Forms**            | ✓ (Form integration)    | ✓ Hooks            | ✓ Form control  | ✗ Absent                   | Form wrapper, validation errors, labels           | T2; ecosys React Hook Form         |
| **Toasts**           | ✓ (Toast système)       | ✗ Hors champ       | ✓ Snackbar      | ✗ Absent                   | Toast provider, dismiss, position                 | T2 optionnel (peut être stateless) |
| **Dark Mode**        | ✓ Natif                 | ✓ CSS tokens       | ✓ ThemeProvider | ✓ CSS vars + media query   | Mode switcher (composant)                         | Laissé au consommateur             |
| **RTL**              | ✓ Logique CSS           | ✓ Hooks adaptatifs | ✓ dir attribute | ✗ Absent (tokens prêts)    | CSS logiques (inline-start/end)                   | T1 si cible intl (FR uniquement)   |
| **Focus Visible**    | ✓ `:focus-visible`      | ✓ Natif            | ✓ Natif         | ✓ 0.2rem orange outline    | —                                                 | ✓ Couvert                          |
| **Reduced Motion**   | ✓ Media query           | ✓ Natif            | ✓ Natif         | ✓ CSS-level invariant      | —                                                 | ✓ Couvert                          |
| **Forced Color**     | ✓ Media query           | ✗ Dépend impl      | ✓ Supporté      | ✓ Prêt (CSS reset)         | Test Forced Color mode                            | ✓ Couvert                          |
| **Skip Links**       | ✓ (pattern courant)     | ✓ Navigation       | ✓ AppBar skip   | ✓ Composant dédié          | —                                                 | ✓ Couvert                          |
| **Typeface Système** | ✓ CSS token             | ✓ CSS token        | ✓ Thème         | ✓ `--lai-font-sans` system | —                                                 | ✓ Couvert                          |
| **Color Tokens**     | ✓ CSS vars              | ✓ CSS vars         | ✓ Thème         | ✓ 11 couleurs sémantiques  | Expand palette (secondary, warning, error)        | T2 optionnel                       |
| **Spacing Scale**    | ✓ Tailwind/CSS          | ✓ CSS vars         | ✓ Thème         | ✓ 1, 2, 3, 4, 6, 8, 12     | —                                                 | ✓ Couvert                          |

---

## T1 Prioritaires (Valeur Benchmark)

### 1. **TextField + Checkbox + Radio Hooks**

- **Pourquoi**: Radix/shadcn/MUI le font natif; nous les omettent volontairement (gérés consommateur)
- **Effort**: 2-3 jours (Aria hooks + CSS)
- **Impact**: ferme la lacune formulaires de base
- **Arbitrage**: consommateur peut les ajouter via Aria `useTextField` directement

### 2. **Dialog/Modal Composable**

- **Pourquoi**: Radix/shadcn offrent Dialog natif; nos consommateurs recyclent StatusMessage + Surface aujourd'hui
- **Effort**: 3-4 jours (Aria Dialog hook + overlay)
- **Impact**: pattern modal cohérent dans l'écosystème
- **Arbitrage**: T2 si Surface + Aria suffisent pour MVP

### 3. **Tabs Composable**

- **Pourquoi**: UITable/shadcn offrent Tabs; cible commun pour navigation locale
- **Effort**: 2 jours (Aria Tabs hook)
- **Impact**: réduit la fragmentation locale (chacun se code Tabs)
- **Arbitrage**: T2; trop de consommateurs utilisent Radix Tabs si besoin avancé

---

## Arbitrage Non-But qui Verrouille une Fonctionnalité Benchmark

**RTL (Right-to-Left)**: Radix/shadcn le font automatique via physical CSS → logical; nous omettons RTL car cible = FR uniquement (LTR). Si internationalisation arabe/hébreux requise, **ajouter surface logique** (`inline-start` vs `left`). Aujourd'hui, non-but.

---

## Notes Registre

| Identifiant              | Valeur                                                                         |
| ------------------------ | ------------------------------------------------------------------------------ |
| **Brick**                | `@libre-ai/ui`                                                                 |
| **Layer**                | 4 (application foundations)                                                    |
| **Status**               | Publish-ready (v0.1.0-draft)                                                   |
| **Dépôt**                | `github.com/libre-ai/libre-ai` → `packages/ui`                                 |
| **License**              | Apache-2.0                                                                     |
| **Dépendances Directes** | `react-aria-components` (catalog)                                              |
| **Dépendances Peer**     | `react`, `react-dom`, `tailwindcss` (optionnel)                                |
| **Exported Paths**       | `.` (index), `./styles.css`, `./tailwind`                                      |
| **Benchmark Parity**     | 60–70% (primitives de base OK, formulaires/dialogs/tables omis volontairement) |
| **Sovereignity Score**   | Très élevé (zéro télémétrie, zéro CDN, zéro fournisseur tiers)                 |
