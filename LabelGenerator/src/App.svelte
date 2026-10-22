<script>
  import Editor from './lib/Editor.svelte'
  import SmallLabels from './lib/SmallLabels.svelte';
  import QdflLabel from './lib/QdflLabel.svelte';

  let tab = $state('panel');
</script>

<nav class="tabs">
  <button class:active={tab === 'panel'} onclick={() => (tab = 'panel')}>
    Etiqueta do painel
  </button>
  <button class:active={tab === 'small'} onclick={() => (tab = 'small')}>
    Etiquetas pequenas (5 × 15×50 mm)
  </button>
  <button class:active={tab === 'qdfl'} onclick={() => (tab = 'qdfl')}>
    Etiqueta QDFL (100×142)
  </button>
</nav>

<!-- all stay mounted so nothing is lost when switching tabs -->
<div hidden={tab !== 'panel'}><Editor /></div>
<div hidden={tab !== 'small'}><SmallLabels active={tab === 'small'} /></div>
<div hidden={tab !== 'qdfl'}><QdflLabel active={tab === 'qdfl'} /></div>

<style>
  .tabs { display: flex; gap: 0.5rem; padding: 1rem 1.5rem 0; }
  .tabs button { padding: 0.5rem 1rem; }
  .tabs .active { background: #222; color: #fff; }
</style>