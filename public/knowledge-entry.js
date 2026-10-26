// Add entry points only when the existing signed-in shell announces a render.
// No extra identity requests, polling or global DOM observer are needed.
function addKnowledgeEntry(anchorId, id, className) {
  const anchor = document.getElementById(anchorId);
  if (!anchor || document.getElementById(id)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.className = className;
  button.innerHTML = '<span aria-hidden="true">📚</span><span><strong>Knowledge</strong><small>Guides, procedures and training for your roles</small></span><b aria-hidden="true">›</b>';
  button.addEventListener('click', () => window.location.assign('/knowledge'));
  anchor.after(button);
}
function render() {
  addKnowledgeEntry('accountSettingsButton', 'drawerKnowledgeButton', 'accountSettingsEntry');
  addKnowledgeEntry('accountHomeSettings', 'accountHomeKnowledge', 'hubTile accountHomeAction accountSettingsEntry');
}
document.addEventListener('abl:drawer-rendered', render);
document.addEventListener('abl:profile-state', render);
render();
