# VionX Privacy Policy

> **DRAFT, version 1.** Not yet reviewed by a lawyer and not legally in force. It must be reviewed under Vietnamese personal-data protection law (including the cross-border transfer impact assessment) before release. Items in square brackets are filled in by the product owner. If the Vietnamese and English versions differ, the version more favourable to you applies.

Last updated: [release date]

## 1. Who we are

VionX is a study and family organiser for Grade 1-12 students and their families. The app has a Parent mode and a Child mode. The data controller is [legal entity], enterprise code [code], [address]; privacy contact: [email], phone: [phone number].

VionX's personal data protection officer: [name or title], email [email], phone [phone number].

VionX accounts are created by a parent or guardian (the child's legal representative). A child needs no phone number, email or Google account to use VionX.

## 2. Data we collect

**Parents:** the phone number or email used to sign in (OTP or Google), display name, household name, time zone, consent choices and the policy versions you accepted.

**Children:** display name, birth year, grade, a preset avatar (no real photos), a `vx-…` login id, a PIN (stored only as a hash; we cannot read it), device session information, and learning data created while using the app (answers, progress, tasks, rewards).

**Technical data:** a random device id created by the app, error logs and access logs for security.

We do **not** collect a child's precise location, do **not** upload camera images or video, and do **not** upload a child's voice.

## 3. Purposes and consent choices

Each kind of processing of a child's data happens only after the parent has consented to that kind specifically. No choice is pre-selected, and accepting this policy does not replace any of the consents below. Parents can review and withdraw each consent at any time under **Privacy** in the app; withdrawal takes effect immediately. Parents can see the record of every consent, with its time, content and policy version, and download these records with the data export.

| Consent | What it covers |
|---|---|
| Core service (`CORE_SERVICE`) | Creating the child's profile and login, storing answers and progress so the app works. Required: without it the child cannot sign in. |
| Transfer of data abroad (`CROSS_BORDER_TRANSFER`) | Storing the child's data on servers abroad and sending it to the recipients abroad listed in section 4. Asked separately, right after the core service. Required for the child to sign in: the service cannot run without storage in Singapore. The parent may decline; we then cannot create the child's account. |
| Learning analytics (`EDUCATION_ANALYTICS`) | Statistics about the child's learning for suggestions and parent reports. |
| AI personalisation (`AI_PERSONALIZATION`) | Sending the question content and the child's skill state (without the name) to an AI service in the United States for explanations, hints and writing feedback. Can be turned on only after the parent has consented to the transfer of data abroad. |
| Microphone for speaking practice (`MICROPHONE_SPEAKING`) | Using the microphone in speaking or reading exercises the child starts. Audio is processed on the phone and never uploaded. |
| Activity via Health Connect (`HEALTH_CONNECT_ACTIVITY`) | Reading steps and active minutes from Health Connect. No heart rate, no GPS routes. |
| Competition area (`COMPETITION_AREA`) | Using the province, city or district chosen by the parent to suggest suitable competitions. |

**Child assent:** for children aged 7 or older, AI, microphone and Health Connect features are switched on only when the child also agrees on a child-facing screen, in addition to the parent's consent. The child may decline.

**Sensitive personal data:** under Decree 356/2025/ND-CP, the following may be sensitive personal data: (a) steps and active minutes read from Health Connect; (b) data about the child's learning activity and use of the app used for learning analytics. We process this data only when the parent (and, for Health Connect, the child if aged 7 or older) has consented separately to each of these types in the table above, and we apply enhanced protection. Activity data is never shared with any insurer, healthcare provider or advertiser and is never sent to the AI service.

**AI-generated content:** AI only gives explanations, hints and feedback. It does not automatically decide the child's scores, rankings or access to the service. All AI-generated content is clearly labelled as AI-generated in the app. Parents can ask us at [email] why the AI gave a suggestion.

When this policy changes in a way that needs renewed consent, the affected features pause until the parent confirms the new version.

## 4. Where data is stored and cross-border transfers

Family data is stored on **Supabase** infrastructure in **Singapore** (Amazon Web Services region ap-southeast-1). Storage abroad and sending data to the recipients below are transfers of personal data outside Vietnam. We transfer a child's data only after the parent has consented to this separately (`CROSS_BORDER_TRANSFER`, see section 3); accepting this policy is not treated as that consent.

| Recipient | Role and purpose | Data | Storage location, recipient's country | Safeguards |
|---|---|---|---|---|
| Supabase Inc. | Storage, authentication, running VionX's servers | All account and learning data | Servers in Singapore (AWS ap-southeast-1); company in [country, to be confirmed under the data processing agreement] | Data processing agreement; encryption in transit and at rest |
| Anthropic PBC | Claude AI models, only when the parent turns on AI personalisation | Question content, grade, skill state, a pseudonymous id; no name, phone number or login id | United States | Data processing agreement; encryption in transit; not used to train models |
| Google LLC | Google sign-in, if the parent uses it | The parent's email address and Google account id | United States [to be confirmed] | Google's terms of service; encryption in transit |
| [SMS provider name] | Sending sign-in OTP codes by text message | The parent's phone number, the OTP code | [country] | Data processing agreement; encryption in transit |
| Functional Software, Inc. (Sentry) | App error monitoring | Technical error logs, the random device id; no names or answers | [country, to be confirmed for the chosen data region] | Data processing agreement; encryption in transit and at rest |

Under Anthropic's current commercial terms, API data is not used to train models and is deleted after at most [N] days, unless kept longer to investigate usage-policy violations [to be confirmed against the data processing agreement dated ...].

Data is encrypted in transit and at rest. Each processor may use data only on our instructions, under a written data processing agreement with confidentiality, incident notification and deletion at the end of the service. We prepare the cross-border transfer impact assessment and file it with the personal data protection authority of the Ministry of Public Security as required by law.

Shared learning content (questions, passages) is created with AI assistance and reviewed by people; that library contains no personal data.

## 5. Sharing

We do not sell personal data and do not use children's data for advertising. Data is shared only with the processors that help us run the service, all listed in the table in section 4. We may disclose data to competent authorities when the law requires it.

## 6. Retention

Data is kept while the family uses VionX. When a parent asks for deletion:

- the account or child profile is **disabled immediately**;
- during these 14 days the parent can cancel the request with **Cancel deletion request** in the app's **Privacy** section, which re-enables the account or child profile;
- after **14 days** the data is **permanently deleted** and cannot be recovered, no later than 20 days after the request;
- reward and transaction ledgers are **anonymised** instead of deleted (ids are replaced by random ids that cannot be linked back), so totals stay correct but can no longer be linked to the child or family;
- a record that the request was fulfilled (ids only, no names) is kept as proof of compliance;
- related audit logs and system event logs are kept for **1 year** after the deletion, holding only pseudonymous ids (no names, phone numbers, email addresses or other personal data), and are then deleted. Pseudonymised data is still personal data and is protected as such.

Data export files can be downloaded for **24 hours** and are then deleted.

## 7. Rights of parents and children

As the child's legal representative, a parent has the right to be informed about processing; to consent or refuse, and to withdraw consent; to view, access and correct data; to delete data; to restrict processing; to object to processing; to receive the data; to complain, sue and claim compensation; and to ask for data protection measures.

Under **Privacy** in the app, a parent can:

- review and withdraw each consent for each child, with its history;
- see the policy versions they accepted;
- **export** the whole household's data as a ZIP file (JSON) with a download link valid for 24 hours;
- **delete a child's profile**;
- **delete the account and all household data**. This can also be done on the web page [account deletion URL] without installing the app.

A child can ask a parent to use these rights; a child aged 7 or older can decline their own agreement for AI, microphone and Health Connect in the app.

Parents can also contact [email] or the data protection officer (section 1) to correct data, restrict processing, object to processing or complain. We confirm receipt within **2 working days** and complete:

- withdrawal of consent, restriction or objection: within **15 days** at most (in the app, withdrawal takes effect immediately);
- providing or correcting data: within **10 days** at most;
- deleting data: within **20 days** at most.

If we need an extension, we tell you the reason before the deadline.

Parents have the right to complain to the personal data protection authority of the Ministry of Public Security.

## 8. Security

PINs are stored only as hashes; child sessions use random tokens that parents can revoke; wrong PIN attempts are limited. The app never accesses the database directly: every request goes through our server and sees only the family's own data. Every admin access to a child's data is logged.

**Incident notification:** if we discover an incident in which personal data is disclosed or lost in a way that may cause harm, we notify the personal data protection authority of the Ministry of Public Security within **72 hours** of discovery, and notify the affected parents in the app and by [email/SMS] with guidance on protecting themselves.

## 9. Children

VionX is designed for students. Children use VionX only through an account created and managed by a parent. The app has no public messaging between children.

## 10. Changes

Every change creates a new version, announced in the app. If a change affects consent choices, we ask the parent again before continuing the affected processing.
