export const query = new URLSearchParams(window.location.search);
export const destination = query.get('view') === 'valley' ? 'valley' : query.get('start');
export const challengeArrival = ['avalanche', 'slalom', 'race'].includes(query.get('challenge'));
export const directArrival = challengeArrival || [
  'roundhouse', 'come-along', 'olympic-plaza', 'creekside', 'inukshuk', 'valley', 'valley-forest', 'fairmont', 'dustys',
  'creekside-slope', 'alpine-cliffs', 'glacier-cave', 'glacier-cave-interior', 'skiers-plaza', 'wildlife',
  'helicopter', 'snowcat', 'snowmobile', 'wingsuit', 'bike',
].includes(destination);

