interface Member {
  id: string; first_name: string | null; last_name: string | null; email: string | null;
  group_id: string | null; supervisor_id?: string | null; platform?: string | null;
}
interface Client { group_id: string | null; assigned_to: string | null; platform?: string | null }
export interface AssignmentNames { agent?: string; group: string; supervisor: string }

// Resolve ownership from current assignments, never from who created the account.
// Incomplete or invalid links do not borrow staff names from a different group.
export function createAssignmentLookup(members: Member[], roles: { user_id: string; role: string }[], groups: { id: string; name: string }[], unassigned: string, unavailable: string) {
  const byId = new Map(members.map(member => [member.id, member]));
  const roleOf = new Map(roles.map(role => [role.user_id, role.role]));
  const groupNames = new Map(groups.map(group => [group.id, group.name]));
  const name = (member: Member) => `${member.first_name || ''} ${member.last_name || ''}`.trim() || member.email || unavailable;
  const sameScope = (parent: Member, child: { group_id: string | null; platform?: string | null }) => Boolean(child.group_id)
    && parent.group_id === child.group_id && (!parent.platform || !child.platform || parent.platform === child.platform);
  const hierarchy = (agent: Member): AssignmentNames => {
    const supervisor = agent.supervisor_id ? byId.get(agent.supervisor_id) : null;
    return {
      group: agent.group_id ? groupNames.get(agent.group_id) || unavailable : unassigned,
      supervisor: !agent.supervisor_id ? unassigned : supervisor && roleOf.get(supervisor.id) === 'supervisor' && sameScope(supervisor, agent) ? name(supervisor) : unavailable,
    };
  };
  return {
    agent: hierarchy,
    client: (client: Client): AssignmentNames => {
      const agent = client.assigned_to ? byId.get(client.assigned_to) : null;
      const validAgent = agent && roleOf.get(agent.id) === 'agent' && sameScope(agent, client) ? agent : null;
      return {
        agent: !client.assigned_to ? unassigned : validAgent ? name(validAgent) : unavailable,
        group: client.group_id ? groupNames.get(client.group_id) || unavailable : unassigned,
        supervisor: !client.assigned_to ? unassigned : validAgent ? hierarchy(validAgent).supervisor : unavailable,
      };
    },
  };
}

