import type { Layout, Shape } from 'plotly.js';

/** Shared dark-theme layout for metrics charts. */
export function buildDarkLayout(overrides?: Partial<Layout>): Partial<Layout> {
  return {
    paper_bgcolor: 'rgba(0, 0, 0, 0.18)',
    plot_bgcolor: 'transparent',
    font: { color: 'rgba(255,255,255,0.55)', size: 10 },
    margin: { l: 50, r: 12, t: 8, b: 28 },
    xaxis: {
      gridcolor: 'rgba(255,255,255,0.12)',
      zerolinecolor: 'rgba(255,255,255,0.12)',
      title: { text: '' },
    },
    yaxis: {
      gridcolor: 'rgba(255,255,255,0.12)',
      zerolinecolor: 'rgba(255,255,255,0.12)',
      title: { text: '' },
    },
    hovermode: 'x unified',
    hoverlabel: {
      bgcolor: '#1e1e1e',
      bordercolor: 'rgba(255,255,255,0.2)',
      font: { color: '#fff', size: 11 },
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
