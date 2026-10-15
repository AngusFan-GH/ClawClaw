// @ts-nocheck -- ported client compatibility layer; host contracts remain strictly checked.
import { catalogState } from './catalog.js';
import { refreshTeams, subscribeTeams, teamState } from './team-cache.js';
import { useTeamLocale, localizeTeam, localizedExperts } from './team-locale.js';
import React from 'react';
import type { ExpertTeam, TeamSnapshot } from '../team-contract.js';
import type { ExpertSummary } from '../expert-contract.js';
import type { TeamReferenceTarget } from './team-reference.js';
import { TeamDetails, unwrap, type TeamRemote } from './team-ui.js';
import { TeamAvatars, teamIssue, IconEye } from './team-shared.js';
export function TeamMenu(props: {
    remote: TeamRemote;
    prepareSelect?(): (team: TeamReferenceTarget, example?: string) => boolean | Promise<boolean>;
    onSelected(): void;
    onExpertsChanged?(): void;
}) {
    const { locale, tx } = useTeamLocale();

    const [snapshot, setSnapshot] = React.useState<TeamSnapshot | null>(() => teamState(props.remote));
    const [rawExperts, setExperts] = React.useState<ExpertSummary[]>(() => {
        const catalog = catalogState(props.remote);
        return catalog.revision < 0 ? [] : [...catalog.experts];
    });
    const experts = localizedExperts(rawExperts, locale);
    const [query, setQuery] = React.useState('');
    const [error, setError] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [detail, setDetail] = React.useState<ExpertTeam | null>(null);
    const alive = React.useRef(true);
    React.useEffect(() => {
        alive.current = true;
        void load();
        const timer = setInterval(() => { if (!busy) void load(); }, 3000);
        const unsubscribe = subscribeTeams(props.remote, () => {
            if (!alive.current)
                return;
            const next = teamState(props.remote);
            if (next)
                setSnapshot(next);
        });
        return () => {
            alive.current = false;
            clearInterval(timer);
            unsubscribe();
        };
    }, [props.remote, busy]);
    const load = async () => {
        try {
            const teams = await refreshTeams(props.remote);
            if (!alive.current)
                return;
            setSnapshot(teams);
            const known = catalogState(props.remote);
            if (known.revision >= 0)
                setExperts([...known.experts]);
            else {
                const catalog = await unwrap(props.remote.getCatalog());
                if (alive.current)
                    setExperts(catalog.experts);
            }
            if (alive.current)
                setError('');
        }
        catch (cause) {
            if (alive.current)
                setError(cause instanceof Error ? tx(cause.message) : tx("专家团加载失败"));
        }
    };
    const pick = async (team: ExpertTeam, example?: string) => {
        if (busy || !snapshot)
            return;
        if (teamIssue(team, experts, snapshot.enabledExperts) || team.connectorStates.some(connector => team.connectors.some(binding => binding.name === connector.dependency && binding.required && binding.enabled) && connector.state !== 'running')) {
            setError(tx("专家团成员或必需能力尚未就绪，请先在设置中修复。"));
            return;
        }
        const insert = props.prepareSelect?.();
        setBusy(true);
        try {
            if (!await insert?.(team, example))
                throw new Error(tx("无法插入团队，请确认当前聊天草稿后重试。"));
            props.onSelected();
        }
        catch (cause) {
            if (alive.current)
                setError(cause instanceof Error ? tx(cause.message) : tx("选择失败。"));
        }
        finally {
            if (alive.current)
                setBusy(false);
        }
    };
    const teams = snapshot?.teams.map(team => localizeTeam(team, locale)).filter((t) =>
        `${t.name} ${t.description}`
            .toLowerCase()
            .includes(query.toLowerCase())) ?? [];
    return (<div className="agt-compact">
      <div className="aag-discovery-tools">
        <input type="search" autoFocus aria-label={tx("搜索专家团")} placeholder={tx("搜索团队或工作目标")} value={query} onChange={(e) => setQuery(e.target.value)}/>
      </div>
      {error && (<div role="alert">
          {error}
          <button type="button" onClick={() => void load()}>{tx("刷新")}</button>
        </div>)}
      <div className="agt-compact-list">
        {teams.map((team) => {
          const blocked = !!snapshot && !!teamIssue(team, experts, snapshot.enabledExperts);
          return (<div className="agt-compact-row" key={team.id}>
            <button type="button" disabled={busy || blocked} onClick={() => void pick(team)}>
              <TeamAvatars team={team} experts={experts}/>
              <span>{team.name}</span>
              <small>{team.members.length}{tx("人")}{blocked ? tx(" · 需修复") : ''}</small>
            </button>
            <button type="button" aria-label={tx("查看{0}详情", [team.name])} onClick={() => setDetail(team)}>
              <IconEye size={16}/>
            </button>
          </div>);
        })}
        {!teams.length && (<p className="aag-menu-empty" role="status">
            {snapshot ? tx("没有匹配的专家团。") : tx("正在加载…")}
          </p>)}
      </div>
      {detail && (<TeamDetails team={detail} experts={experts} close={() => setDetail(null)} onSelect={(example) => void pick(detail, example)}/>)}
    </div>);
}
