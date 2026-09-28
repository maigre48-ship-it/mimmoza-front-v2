import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeDesignPacket, sanitizeQuestionPacket, validateDesignQuestions, validateGeneratedDesign } from './validation.ts';

const packet = sanitizeDesignPacket({ programme: 'Hôtel', target: 'séjours de loisirs', location: 'Ascain',
  horizonYears: 15, priority: 'Durabilité et entretien simple', pluZone: 'UA', signals: [
    { id: 'houzz-2026', title: 'Houzz 2026', url: 'https://example.org/article', observation: 'Savoir-faire et adaptation dans le temps.',
      scope: 'États-Unis', year: '2026', family: 'durable' },
  ] });

const direction = (family: string, sourceIds = ['houzz-2026']) => ({ family, title: `Direction ${family}`, intent: 'Une ambiance liée au programme et à son usage.',
  palette: [{ name: 'Ivoire', hex: '#F1F1F1', use: 'Fond des chambres' }, { name: 'Bois', hex: '#B9A281', use: 'Menuiseries' },
    { name: 'Ardoise', hex: '#4A555A', use: 'Repères visuels' }], materials: ['Bois réparable', 'Enduit durable'],
  architecture: ['Entrée lisible pour les visiteurs', 'Façade à vérifier avec le PLU'],
  interiors: ['Chambres faciles à entretenir', 'Éclairage adaptable à l’usage'],
  lasting: ['Qualité de la lumière', 'Plan de chambre flexible'], adaptable: ['Textiles remplaçables', 'Mobilier renouvelable'],
  vigilance: 'Valider entretien, acoustique et conformité avec un exploitant.', sourceIds });

test('le dossier exige des références commentées et des liens HTTPS', () => {
  assert.ok(packet);
  assert.equal(sanitizeDesignPacket({ ...packet, signals: [{ ...packet!.signals[0], url: 'http://example.org' }] }), null);
  assert.equal(sanitizeDesignPacket({ ...packet, signals: [{ ...packet!.signals[0], observation: 'Joli' }] }), null);
});

test('la réponse est refusée si elle cite une référence absente ou une palette invalide', () => {
  assert.ok(packet);
  const valid = { directions: [direction('durable'), direction('contemporain'), direction('expressif')],
    recommendedFamily: 'durable', rationale: 'La direction durable offre une base facile à adapter.',
    checks: ['Comparer avec des usagers représentatifs', 'Vérifier le règlement PLU opposable', 'Chiffrer les matériaux et l’entretien'] };
  assert.ok(validateGeneratedDesign(valid, packet!));
  assert.equal(validateGeneratedDesign({ ...valid, directions: [direction('durable', ['invented']), direction('contemporain'), direction('expressif')] }, packet!), null);
  assert.equal(validateGeneratedDesign({ ...valid, directions: [direction('durable'), direction('durable'), direction('expressif')] }, packet!), null);
});

test('le mode Auto accepte une cible à découvrir et refuse un questionnaire incomplet', () => {
  assert.ok(sanitizeQuestionPacket({ programme: 'Hôtel', target: '', location: 'Ascain', horizonYears: 15, priority: 'Durabilité' }));
  assert.equal(sanitizeQuestionPacket({ programme: 'Hôtel', location: '', horizonYears: 15, priority: 'Durabilité' }), null);
  const questions = ['audience', 'atmosphere', 'operation', 'identity'].map((id) => ({ id,
    question: `Quel choix pour ${id} dans ce projet ?`, why: 'Cela oriente le programme.', options: ['Option A', 'Option B', 'Option C'] }));
  assert.equal(validateDesignQuestions({ questions })?.length, 4);
  assert.equal(validateDesignQuestions({ questions: questions.slice(0, 3) }), null);
  assert.equal(validateDesignQuestions({ questions: [questions[0], questions[0], questions[2], questions[3]] }), null);
});

test('les quatre réponses utilisateur doivent être fournies au brief Auto', () => {
  assert.ok(packet);
  const answers = { audience: 'Voyageurs en famille', atmosphere: 'Calme chaleureux', operation: 'Entretien simple', identity: 'Ancrage local discret' };
  assert.deepEqual(sanitizeDesignPacket({ ...packet, answers })?.answers, answers);
  assert.equal(sanitizeDesignPacket({ ...packet, answers: { ...answers, identity: '' } }), null);
});
