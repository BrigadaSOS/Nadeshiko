import {
  Chart,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
  BarController,
  LineController,
  DoughnutController,
  PieController,
} from 'chart.js';

Chart.register(
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
  BarController,
  LineController,
  DoughnutController,
  PieController,
);

Chart.defaults.color = 'rgb(156, 163, 175)';
Chart.defaults.borderColor = 'rgba(255, 255, 255, 0.06)';

if (Chart.defaults.plugins.tooltip) {
  Chart.defaults.plugins.tooltip.backgroundColor = '#1f1f1f';
  Chart.defaults.plugins.tooltip.titleColor = '#fff';
  Chart.defaults.plugins.tooltip.bodyColor = '#fff';
  Chart.defaults.plugins.tooltip.borderColor = 'rgba(255, 255, 255, 0.1)';
  Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.tooltip.cornerRadius = 6;
  Chart.defaults.plugins.tooltip.padding = 8;
}

if (Chart.defaults.plugins.legend) {
  Chart.defaults.plugins.legend.labels.color = 'rgb(209, 213, 219)';
}

export default defineNuxtPlugin(() => {});
