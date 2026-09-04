# Phase 1 — audit d’architecture (2026-09-04)

## Périmètre et méthode

Audit statique du monorepo `midday-ai/midday`, sans modification de code métier ni
de schéma. Ont été inspectés les manifests des 33 workspaces, les 39 migrations,
les schémas Drizzle/PostgreSQL, les routes REST/tRPC, les applications, les jobs,
l’AI/MCP, les tests et les workflows CI/CD. Les constats de sécurité ci-dessous
sont des risques à vérifier par tests et revue de configuration de production ;
ils ne constituent pas une affirmation d’exploitation.

## A. Architecture actuelle

* Monorepo Bun/Turbo : `apps/dashboard` (Next.js), `apps/api` (Hono,
  OpenAPI+tRPC), `apps/worker` (BullMQ), `apps/desktop` (Tauri) et
  `apps/website` (Next.js marketing). Les packages partagent les domaines métier,
  Drizzle/PostgreSQL, Supabase, UI, jobs Trigger.dev et utilitaires.
* Le flux principal est : Dashboard/Desktop/Bots/MCP -> API REST ou tRPC ->
  requêtes `@midday/db` -> PostgreSQL ; les imports bancaires, traitement de
  documents, exports et synchronisations passent par Worker/BullMQ ou Trigger.dev.
  PostgreSQL dispose d’un primaire et de lectures répliquées avec une voie
  primaire après écriture.
* Le modèle d’isolation est `teamId` (tenant). L’auth REST accepte session
  Supabase, OAuth et clés API ; les scopes OAuth/API sont développés côté API.
  Le RBAC produit est actuellement très réduit (`owner`, `member`).
* Les domaines implémentés sont transactions bancaires, comptes/connecteurs,
  catégories/tags, clients, factures récurrentes et paiements Stripe, pointage,
  inbox/rapprochement, documents, rapports et synchronisation comptable.

### Cartographie des composants

| Composant | Rôle, données et flux | Intégrations/risques/évolution |
| --- | --- | --- |
| `apps/dashboard` | UI Next.js multilingue pour transactions, factures, vault, inbox, rapports, paramètres et assistant. Consomme tRPC/REST et Supabase. | Surface fonctionnelle principale ; conserver. Ajouter des vues de piste d’audit et des écrans de confirmation déterministes, sans déplacer les règles financières dans le client. |
| `apps/api` | Façade Hono : REST OpenAPI, tRPC, OAuth, webhooks, chat, MCP et paiements. Crée le contexte authentifié `teamId`. | Cœur d’autorisation. Centraliser les décisions de politique et les commandes financières ici avant toute extension souveraine. |
| `apps/worker`, `packages/jobs` | Traitements BullMQ/Trigger.dev : sync bancaire/comptable, imports, OCR/document, exports, notifications, récurrence. | Les traitements asynchrones doivent recevoir correlation/idempotency IDs et écrire les événements d’audit transactionnellement. |
| `packages/db` | Drizzle/PostgreSQL, 39 migrations, requêtes et index. Tables de transactions, factures, documents, activités, OAuth et intégrations. | Source de vérité actuelle, mais non grand livre : créer un noyau append-only séparé, ne pas transformer les tables opérationnelles en place. |
| `banking`, `accounting`, `inbox`, `documents`, `invoice` | Adaptateurs bancaires, Xero/QB/Fortnox, Gmail/Outlook, extraction/OCR et PDF/devises/récurrence. | Conserver les contrats d’adaptateur ; introduire un contrat d’événements canonique et une boîte d’envoi (outbox). |
| `bot`, `mcp-apps`, `insights` | Bots Slack/Telegram/WhatsApp/iMessage, UI MCP et analyses/insights AI. | Les canaux conversationnels sont des surfaces d’action : appliquer les mêmes capacités, confirmations et audit que l’API. |
| `desktop`, `desktop-client` | Client Tauri et API de fichiers contrôlée. | Ne pas ajouter de capture implicite du poste ; les imports professionnels doivent rester explicitement déclenchés et consentis. |
| `ui`, `utils`, `cache`, `logger`, `events`, `supabase`, `trpc` | Fondations partagées. | Bon socle ; documenter les frontières de responsabilité et éviter que `db` dépende de packages de domaine circulaires. |

## B. Modèle financier et données — constats

* `transactions` porte des montants, devise, date, méthode/statut, compte,
  catégorie, fournisseur/description et métadonnées issues des banques. Les
  comptes et taux de change existent ; les factures portent montant, devise,
  taxes, lignes, statut et informations Stripe. Cela couvre l’exploitation SMB,
  pas une comptabilité à partie double.
* Les montants utilisent `numeric(10,2)` converti en JavaScript `number`.
  C’est insuffisant pour une infrastructure financière : risque de précision IEEE
  754 et plafond à 99 999 999,99. Prévoir montant entier en unités mineures ou
  `numeric` sérialisé en chaîne, échelle/devise explicites et validation.
* Les données critiques sont largement mutables (`updatedAt`, statuts, JSONB) et
  les suppressions/cascades existent. `activities` est un fil de notifications,
  pas un audit trail immuable : il manque ancienne/nouvelle valeur, acteur de
  service, résultat, correlation ID, motif, intégrité et rétention.
* Les documents conservent chemins, contenu extrait, métadonnées et état de
  traitement. Il n’existe pas de hash d’original, version, chaîne de garde,
  horodatage qualifié ou lien universel à une opération/preuve.

### Architecture cible recommandée

Adopter une évolution par modules, sans migration destructive :

1. **Noyau de registre** : `financial_events` append-only et `journal_entries` /
   `journal_lines` équilibrées, avec montant original, devise, FX, dates
   effectives/enregistrées, source, référence externe, idempotency key et
   `supersedes_event_id`. Les tables actuelles deviennent des projections et
   restent compatibles.
2. **Politiques et organisations** : organisation, unité, programme, projet,
   budget, ligne, fournisseur, contrat, engagement et workflow de décision ;
   RBAC/ABAC par capacité et séparation des tâches. Les règles juridiques sont
   versionnées par juridiction, jamais encodées comme une « conformité » implicite.
3. **Evidence Vault** : objet immuable versionné, hash SHA-256, MIME/taille,
   stockage chiffré, chaîne `previous_hash`, propriétaire/auteur, liens vers
   événements et journal d’accès. Les captures restent opt-in.
4. **Audit + outbox** : événements append-only scellés par hash, actor/service,
   IP seulement si base légale et politique de rétention, correlation/causation
   IDs ; outbox transactionnelle pour jobs/webhooks.
5. **Read models** : projections par tenant, recherche, dashboards et détection
   d’anomalies ; une anomalie est un dossier explicable avec règles, éléments de
   preuve et revue humaine, jamais un verdict de fraude.

## C. Feature matrix et écarts

| Capacité cible | État actuel | Écart prioritaire |
| --- | --- | --- |
| Transactions, comptes, catégories, FX | Partiel opérationnel | Préserver les originaux, immutabilité, rapprochement et transferts canoniques. |
| Facturation/paiement/remboursement | Fort pour SMB/Stripe | Écritures de règlement, allocations partielles, créances/dettes et preuve de paiement. |
| Comptabilité/trésorerie | Sync externe et rapports | Grand livre, soldes dérivés, clôture, prévisions et rapprochement auditable. |
| Evidence Vault | Documents/inbox/extraction | Hash, version, rétention, chaîne de garde, liens d’opération, audit d’accès. |
| Audit trail | Activités/notifications | Journal inviolable complet, exports vérifiables et suppression logique. |
| Public finance | Absent | Modèle configurable programme→budget→engagement→contrat→paiement. |
| Recettes publiques | Absent | Sources, affectations, encaissement, dette/don/subvention et preuve. |
| Anomalies | Matching/insights partiels | Règles, scores explicables, case management et revue humaine. |
| Souveraineté | Déploiement SaaS Railway/Vercel/Trigger | Profils cloud/on-prem, KMS/HSM, réseau, sauvegarde/DR et opérations isolées. |

## D. Sécurité, permissions et isolation

**Forces.** Authentification centrale, token hashing, OAuth/scopes, RLS déclarée
dans le schéma, contrôles `teamId` dans de nombreuses requêtes, en-têtes de
sécurité/CORS, signatures de webhooks, rate limiting MCP/chat, Sentry et tests
d’isolation OAuth.

**Risques à traiter, dans cet ordre.**

1. Les politiques RLS observées sont fréquemment permissives et le modèle ne
   distingue que owner/member ; réviser table par table `USING`/`WITH CHECK`,
   rôles de lecture et comptes de service. Ajouter des tests cross-tenant pour
   chaque mutation, téléchargement et outil MCP.
2. Les routes serveur utilisent une base privilégiée : RLS n’est pas une barrière
   suffisante sans filtrage systématique `teamId`. Instituer un repository tenant
   scoped et interdire les requêtes non scellées par tenant en revue/lint.
3. Les fichiers, OCR et URLs externes nécessitent une revue SSRF, type/taille,
   antivirus/quarantaine, URL signées courtes et journalisation des accès.
4. Les tokens d’intégrations et les exports sont des données sensibles : rotation,
   chiffrement par tenant/KMS, portée minimale, révocation et audit sont requis.
5. Les endpoints administratifs et MCP doivent passer de simples scopes à des
   capacités contextualisées (tenant, rôle, objet, plafond, séparation des tâches)
   et exiger confirmation hors bande pour les commandes sensibles.

## E. AI et MCP

* L’assistant réutilise le serveur MCP interne, sélectionne les outils avec un
  index `toolpick`, dispose de recherche web et de tools Composio, avec une limite
  de 10 étapes. Le prompt interdit explicitement l’invention de chiffres et impose
  brouillon puis confirmation séparée pour l’envoi de facture : ce comportement
  doit être conservé.
* MCP expose ressources, prompts et outils par domaines (transactions, factures,
  documents, inbox, clients, comptes, catégories, tags, tracker, rapports,
  équipe). Les annotations distinguent lecture, écriture et destructif ; scopes
  conditionnent l’enregistrement d’outils. Le routeur exige Bearer/OAuth et limite
  les requêtes.
* Limites : le bot reçoit `apis.all`, l’assistant assemble également outils
  Composio et web search, et la confirmation est principalement une instruction
  de prompt. Les actions financières doivent être transformées en commandes
  préparées, stockées et signées : **analyse → préparation → confirmation
  explicite liée au digest → exécution idempotente → audit**. Le modèle ne doit
  jamais être le moteur de calcul ni la source de vérité.
* Classer chaque nouvel outil : lecture, écriture réversible, sensible,
  administration. Associer capacité, filtre tenant, schéma strict, rate limit,
  idempotency key, confirmation et événement d’audit. Réactiver les évaluations de
  sélection d’outils dans CI après stabilisation.

## F. Performance, résilience et observabilité

* Points positifs : index tenant/date/état/FTS/trigram, pagination dans plusieurs
  outils, répliques de lecture, voie primaire après écriture, pools instrumentés,
  Server-Timing, Sentry, health/readiness et queues séparées.
* Risques : recherche/document/OCR et exports peuvent produire des charges lourdes;
  JSONB rend les invariants et index ciblés plus difficiles ; l’absence d’outbox
  transactionnelle rend les effets DB/job/webhook vulnérables aux pannes partielles.
  Mesurer p95/p99 par endpoint, saturation pools, latence des queues, DLQ et taux
  de rapprochement avant optimisation.
* Exigences cible : partitionnement/archivage du journal, index par tenant/date,
  backpressure, DLQ/retry borné, idempotence des consommateurs, sauvegardes
  vérifiées et RPO/RTO documentés par profil de déploiement.

## G. Tests, CI/CD et dette technique

* Environ 86 fichiers de tests couvrent utilitaires, connecteurs, matching,
  finance, tRPC, MCP, router et E2E. Il manque des invariants de grand livre,
  propriété/permission systématiques, audit/evidence, résilience des jobs et E2E
  de workflow sensible.
* Les workflows staging et production déploient malgré le job `validate` et les
  évaluations de sélection d’outils désactivés (`if: false`). C’est le risque de
  livraison le plus immédiat ; rétablir une porte de qualité avant le noyau
  financier, avec tests DB reproductibles et migrations forward-only.
* Dette structurante : rôles binaires, statuts/montants mutables, JSONB métier,
  mélange notification/audit, absence de boundary de commande et de contrat
  d’événement commun entre API/worker/jobs.

## H. Priorités et plan par phases

| Phase | Travail sûr et structurant | Complexité |
| --- | --- | --- |
| 1A | ADR du noyau, glossaire, catalogue des données et threat model ; réactiver CI en mode observation. | M |
| 1B | Tables append-only audit/outbox, correlation ID et tests d’intégrité, sans changer les écrans. | L |
| 2 | Registre financier et projections compatibles transactions/factures ; invariants comptables. | XL |
| 3 | Evidence Vault versionné + preuves/hash/accès ; migration progressive des documents. | L |
| 4 | RBAC/ABAC, séparation des tâches, policy engine, matrices MCP et confirmations serveur. | XL |
| 5 | Budgets/engagements/contrats/projets et profil Government configurable. | XL |
| 6 | Anomalies explicables, dashboards de drill-down, performance/DR/on-prem. | XL |

## Décision de phase 1

**Conservé :** toutes les fonctionnalités, les intégrations, l’assistant et MCP.
**Modifié :** aucun code, schéma ou comportement ; ce document est le seul ajout.
**Prochaine étape recommandée :** valider un ADR « immutable financial event and
audit core », puis implémenter uniquement l’outbox/audit append-only avec une
migration additive, des tests de non-effacement et une matrice de permissions.
