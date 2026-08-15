import type { Layout, Shape } from 'plotly.js';
import { appTheme, type AppTheme } from '@/composables/useAppTheme';

/** Chart chrome per theme — derived from the site palette (see src/plugins/vuetify.ts). */
const CHART_THEMES = {
  dark: {
    paper: 'rgba(0, 0, 0, 0.18)',
    font: 'rgba(232, 232, 228, 0.6)',
    grid: 'rgba(232, 232, 228, 0.12)',
    hoverBg: '#2f2f2f',
    hoverBorder: 'rgba(232, 232, 228, 0.2)',
    hoverFont: '#e8e8e4',
  },
  light: {
    paper: 'rgba(55, 53, 47, 0.04)',
    font: 'rgba(55, 53, 47, 0.65)',
    grid: 'rgba(55, 53, 47, 0.12)',
    hoverBg: '#ffffff',
    hoverBorder: 'rgba(55, 53, 47, 0.2)',
    hoverFont: '#37352f',
  },
} as const satisfies Record<AppTheme, unknown>;

/** Shared layout for metrics charts, themed to match the current app theme. */
export function buildChartLayout(overrides?: Partial<Layout>): Partial<Layout> {
  const c = CHART_THEMES[appTheme.value];
  return {
    paper_bgcolor: c.paper,
    plot_bgcolor: 'transparent',
    font: { color: c.font, size: 10 },
    margin: { l: 50, r: 12, t: 8, b: 28 },
    xaxis: {
      gridcolor: c.grid,
      zerolinecolor: c.grid,
      title: { text: '' },
    },
    yaxis: {
      gridcolor: c.grid,
      zerolinecolor: c.grid,
      title: { text: '' },
    },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: c.hoverBg,
      bordercolor: c.hoverBorder,
      font: { color: c.hoverFont, size: 11 },
    },
    ...overrides,
  };
}

/** Vertical playback cursor spanning the plot area. */
export function frameCursorShape(frame: number): Partial<Shape> {
  return {
    type: 'line',
    x0: frame,
    x1: frame,
    y0: 0,
    y1: 1,
    yref: 'paper',
    line: { color: '#ffb74d', width: 1 },
  };
}
