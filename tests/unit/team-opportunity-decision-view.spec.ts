import { describe, expect, it } from 'vitest';

import {
  formatTeamOpportunityAmount,
  teamOpportunityHealthLabel,
  validTeamOpportunitySelection,
} from '../../client/src/pages/TeamOpportunityDecisionPage/team-opportunity-decision-view';

describe('team opportunity decision view helpers', (): void => {
  it('formats health labels in user language', (): void => {
    expect(teamOpportunityHealthLabel('critical')).toBe('立即介入');
    expect(teamOpportunityHealthLabel('on_track')).toBe('按计划推进');
  });

  it('does not render an unknown amount as zero', (): void => {
    expect(formatTeamOpportunityAmount(null)).toBe('金额待补充');
    expect(formatTeamOpportunityAmount(0)).toBe('¥0');
  });

  it('falls back to the first priority when the selected item disappears', (): void => {
    expect(validTeamOpportunitySelection('missing', [
      { key: 'owner-a:opp-a' },
      { key: 'owner-b:opp-b' },
    ])).toBe('owner-a:opp-a');
    expect(validTeamOpportunitySelection('owner-b:opp-b', [
      { key: 'owner-a:opp-a' },
      { key: 'owner-b:opp-b' },
    ])).toBe('owner-b:opp-b');
    expect(validTeamOpportunitySelection('missing', [])).toBeNull();
  });
});
