import { jsx, jsxs } from 'react/jsx-runtime';
import { useValue, useQuery, host, EmptyState, ErrorState, Badge } from '@hermes/plugin-sdk';

function Proposal({ title, values }) {
  return jsxs('section', { children: [jsx('h3', { children: title }), jsx('ol', { children: values.map((value, i) => jsx('li', {
    children: `${value.text} [${value.claim_ids.join(', ')}] — proposed adaptation`
  }, i)) })] });
}

function Nostalgia({ ctx }) {
  const session = useValue(host.state.focusedSessionId);
  const profile = useValue(host.state.focusedSessionProfile);
  const gatewayProfile = useValue(host.state.profile);
  const sameProfile = profile === gatewayProfile;
  const query = useQuery({
    queryKey: ['achiote', profile, session],
    enabled: Boolean(session && sameProfile),
    queryFn: async () => {
      const response = await ctx.rest(`/case?session_id=${encodeURIComponent(session)}`);
      if (!response || !Object.hasOwn(response, 'case')) throw new Error('Achiote returned an invalid case response');
      return response;
    },
    refetchInterval: 5000
  });
  if (!sameProfile) return jsx(EmptyState, { title: 'Open this bot’s Achiote pane', description: 'Cross-profile dish reads are disabled.' });
  if (!session) return jsx(EmptyState, { title: 'Choose a conversation', description: 'Achiote follows the focused session.' });
  if (query.error) return jsx(ErrorState, { title: 'Nostalgia pane unavailable', description: String(query.error.message) });
  if (query.isPending) return jsx('p', { children: 'Loading this session’s cue…' });
  const c = query.data?.case;
  if (!c) return jsx(EmptyState, { title: 'A fragment, not a guess', description: 'Use /achiote, research sources, then achiote_publish. Uncited dossiers are refused.' });
  return jsxs('article', { style: { padding: '16px', overflow: 'auto', color: 'var(--ui-text-secondary)' }, children: [
    jsx('h2', { children: 'Minimum viable nostalgia' }), jsx(Badge, { children: 'Citation-covered · not fact-verified' }),
    jsx('p', { children: `You remember: ${c.memory}` }), jsx('p', { children: `Shopping context: ${c.location} · stock not checked` }),
    jsx(Proposal, { title: 'Try this tiny cue first', values: [c.cue] }),
    jsx(Proposal, { title: 'Recipe experiment', values: c.recipe }),
    jsx(Proposal, { title: 'Local swaps + tradeoffs', values: c.swaps }),
    jsx('h3', { children: 'Claims + citations' }),
    ...c.claims.map(claim => jsxs('section', { children: [jsx('strong', { children: `${claim.id}: ${claim.text}` }),
      ...claim.citations.map((ref, i) => {
        const source = c.sources.find(s => s.id === ref.source_id);
        return jsxs('blockquote', { children: [jsx('p', { children: ref.quote }), jsx('a', {
          href: source.url, target: '_blank', rel: 'noopener noreferrer', children: source.title
        })] }, i);
      })] }, claim.id)),
    jsx('h3', { children: 'Provenance graph' }),
    jsx('ul', { children: c.graph.edges.map((edge, i) => jsx('li', { children: `${edge.from} → ${edge.kind} → ${edge.to}` }, i)) }),
    jsx('h3', { children: 'Still unknown' }), jsx('ul', { children: c.unknowns.map((value, i) => jsx('li', { children: value }, i)) }),
    jsx('small', { children: c.notice })
  ] });
}

export default {
  id: 'achiote', name: 'Achiote', defaultEnabled: false,
  register(ctx) {
    ctx.register({ id: 'nostalgia', area: 'panes', title: 'Achiote · Nostalgia',
      data: { placement: 'right', width: '420px' }, render: () => jsx(Nostalgia, { ctx }) });
  }
};
