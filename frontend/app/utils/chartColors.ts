export const CHART_COLORS = [
  'rgb(96, 165, 250)',
  'rgb(251, 146, 60)',
  'rgb(74, 222, 128)',
  'rgb(248, 113, 113)',
  'rgb(192, 132, 252)',
  'rgb(250, 204, 21)',
  'rgb(45, 212, 191)',
  'rgb(244, 114, 182)',
];

export const CHART_COLORS_ALPHA = CHART_COLORS.map((c) => c.replace('rgb(', 'rgba(').replace(')', ', 0.7)'));
