/**
 * Wire example for `ConsentTextDocumentSchema` (ADR-0021 §D7 "On acceptance" deliverable).
 *
 * The canonical shape of `GET {CONTROL_PLANE_URL}/consent-text.json` — the identifier-free
 * static document the SDK fetches before rendering the consent banner (ADR-0021 §D2).
 *
 * This is a COPY of the served artefact for documentation and test-fixture use. The served
 * artefact itself lives at `apps/control-plane/public/consent-text.json`; the two are held in
 * step by `packages/shared/src/schemas/consent-text.test.ts`, which validates the real file
 * against the schema and asserts this example matches it field-for-field. A drift between the
 * contract and the bytes actually served is the failure that test exists to prevent.
 *
 * @module @estalara/shared/examples/consent-text
 */

import { renderDisclosure13_1 } from '../consent-retention.js';
import type { ConsentTextDocument } from '../schemas/consent-text.js';

export const CONSENT_TEXT_EXAMPLE: ConsentTextDocument = {
  schema_version: 1,
  text_version: '2026-08-24.1',
  locales: {
    en: {
      text: 'We personalize this page based on your browsing behavior.',
      disclosure13_1: renderDisclosure13_1('en'),
      disclosure13_2:
        'To remember your preferences across visits, we store a pseudonymous identifier in your browser for up to 90 days. This identifier is refreshed every 90 days and is deleted if you withdraw consent.',
      disclosurePlatform:
        'If you are a registered investor: your account sign-up consent also covers analysis of your chat messages to identify buying intent, transfer of your inferred buyer profile to the agency/agent, lead ranking by buying-intent strength, and agent-facing summaries of your chat questions. Your chat message text is stored for 13 months, with emails and phone numbers masked; the intent summary is kept for 24 hours.',
      learnMore: 'Learn more ↗',
      accept: 'Accept',
      decline: 'Decline',
    },
    pl: {
      text: 'Personalizujemy tę stronę na podstawie Twojego zachowania.',
      disclosure13_1: renderDisclosure13_1('pl'),
      disclosure13_2:
        'Aby zapamiętać Twoje preferencje pomiędzy wizytami, przechowujemy pseudonimowy identyfikator w Twojej przeglądarce przez maksymalnie 90 dni. Identyfikator ten jest odświeżany co 90 dni i usuwany w przypadku wycofania zgody.',
      disclosurePlatform:
        'Jeśli jesteś zarejestrowanym inwestorem: Twoja zgoda wyrażona przy rejestracji obejmuje również analizę wiadomości na czacie w celu identyfikacji intencji zakupowej, przekazanie wywnioskowanego profilu kupującego agencji/agentowi, ranking inwestorów według siły intencji zakupowej oraz podsumowania pytań z czatu widoczne dla pracowników agencji. Treść wiadomości z czatu jest przechowywana przez 13 miesięcy, z zamaskowanymi adresami e-mail i numerami telefonu; podsumowanie intencji przez 24 godziny.',
      learnMore: 'Dowiedz się więcej ↗',
      accept: 'Akceptuj',
      decline: 'Odrzuć',
    },
    es: {
      text: 'Personalizamos esta página según tu comportamiento de navegación.',
      disclosure13_1: renderDisclosure13_1('es'),
      disclosure13_2:
        'Para recordar tus preferencias entre visitas, almacenamos un identificador seudónimo en tu navegador durante un máximo de 90 días. Este identificador se renueva cada 90 días y se elimina si retiras tu consentimiento.',
      disclosurePlatform:
        'Si eres un inversor registrado: tu consentimiento de registro también cubre el análisis de tus mensajes de chat para identificar la intención de compra, la transferencia de tu perfil de comprador inferido a la agencia/agente, la clasificación por intensidad de intención de compra y los resúmenes de tus preguntas de chat para el equipo de la agencia. El texto de tus mensajes de chat se almacena durante 13 meses, con correos y teléfonos enmascarados; el resumen de intención durante 24 horas.',
      learnMore: 'Más información ↗',
      accept: 'Aceptar',
      decline: 'Rechazar',
    },
  },
};
