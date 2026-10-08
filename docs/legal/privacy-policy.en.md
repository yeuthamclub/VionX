# VionX Privacy Policy

> **DRAFT, version 1.** Not yet reviewed by a lawyer and not legally in force. It must be reviewed under Vietnamese personal-data protection law (including the cross-border transfer impact assessment) before release. Items in square brackets are filled in by the product owner. The Vietnamese version prevails.

Last updated: [release date]

## 1. Who we are

VionX is a study and family organiser for Grade 1-12 students and their families. The app has a Parent mode and a Child mode. The data controller is [legal entity], [address]; privacy contact: [email].

VionX accounts are created by a parent or guardian. A child needs no phone number, email or Google account to use VionX.

## 2. Data we collect

**Parents:** the phone number or email used to sign in (OTP or Google), display name, household name, time zone, consent choices and the policy versions you accepted.

**Children:** display name, birth year, grade, a preset avatar (no real photos), a `vx-…` login id, a PIN (stored only as a hash; we cannot read it), device session information, and learning data created while using the app (answers, progress, tasks, rewards).

**Technical data:** a random device id created by the app, error logs and access logs for security.

We do **not** collect a child's precise location, do **not** upload camera images or video, and do **not** upload a child's voice.

## 3. Purposes and consent choices

Each kind of processing of a child's data happens only after the parent has consented to that kind specifically. Parents can review and withdraw each consent at any time under **Privacy** in the app; withdrawal takes effect immediately.

| Consent | What it covers |
|---|---|
| Core service (`CORE_SERVICE`) | Creating the child's profile and login, storing answers and progress so the app works. Required: without it the child cannot sign in. |
| Learning analytics (`EDUCATION_ANALYTICS`) | Statistics about the child's learning for suggestions and parent reports. |
| AI personalisation (`AI_PERSONALIZATION`) | Sending the question content and the child's skill state (without the name) to an AI service for explanations, hints and writing feedback. |
| Microphone for speaking practice (`MICROPHONE_SPEAKING`) | Using the microphone in speaking or reading exercises the child starts. Audio is processed on the phone and never uploaded. |
| Activity via Health Connect (`HEALTH_CONNECT_ACTIVITY`) | Reading steps and active minutes from Health Connect. No heart rate, no GPS routes. |
| Competition area (`COMPETITION_AREA`) | Using the province, city or district chosen by the parent to suggest suitable competitions. |

**Child assent:** for children aged 7 or older, AI, microphone and Health Connect features are switched on only when the child also agrees on a child-facing screen, in addition to the parent's consent. The child may decline.

When this policy changes in a way that needs renewed consent, the affected features pause until the parent confirms the new version.

## 4. Where data is stored and cross-border transfers

Family data is stored on **Supabase** infrastructure in **Singapore** (Amazon Web Services region ap-southeast-1). This is a transfer of personal data outside Vietnam; by accepting this policy the parent consents to that transfer. Connections are always encrypted.

When a parent turns on **AI personalisation**, the content to be processed is sent to **Anthropic** (provider of the Claude AI models, United States) through Anthropic's API. We send only a pseudonymous id, the grade and the skill state, never the child's name, phone number or login id. Under Anthropic's current commercial terms, API data is not used to train models and is retained only for a limited period [to be confirmed in review].

Shared learning content (questions, passages) is created with AI assistance and reviewed by people; that library contains no personal data.

## 5. Sharing

We do not sell personal data and do not use children's data for advertising. Data is shared only with processors that help us run the service: Supabase (storage, authentication), Anthropic (AI, only with consent), Google (Google sign-in, if the parent uses it), the SMS provider that sends OTP codes, and an app error-monitoring service. We may disclose data to competent authorities when the law requires it.

## 6. Retention

Data is kept while the family uses VionX. When a parent asks for deletion:

- the account or child profile is **disabled immediately**;
- during these 14 days the parent can cancel the request with **Cancel deletion request** in the app's **Privacy** section, which re-enables the account or child profile;
- after **14 days** the data is **permanently deleted**;
- reward and transaction ledgers are **anonymised** instead of deleted, so totals stay correct but can no longer be linked to the child or family;
- a record that the request was fulfilled (ids only, no names) is kept as proof of compliance;
- related audit logs and system event logs are kept for **1 year** after the deletion, holding only pseudonymous ids (no names, phone numbers, email addresses or other personal data), and are then deleted.

Data export files can be downloaded for **24 hours** and are then deleted.

## 7. Rights of parents and children

Under **Privacy** in the app, a parent can:

- review and withdraw each consent for each child, with its history;
- see the policy versions they accepted;
- **export** the whole household's data as a ZIP file (JSON) with a download link valid for 24 hours;
- **delete a child's profile**;
- **delete the account and all household data**. This can also be done on the web page [account deletion URL] without installing the app.

Parents can also contact [email] to correct data, restrict processing or complain. We answer within the time limits set by law.

## 8. Security

PINs are stored only as hashes; child sessions use random tokens that parents can revoke; wrong PIN attempts are limited. The app never accesses the database directly: every request goes through our server and sees only the family's own data. Every admin access to a child's data is logged.

## 9. Children

VionX is designed for students. Children use VionX only through an account created and managed by a parent. The app has no public messaging between children.

## 10. Changes

Every change creates a new version, announced in the app. If a change affects consent choices, we ask the parent again before continuing the affected processing.
