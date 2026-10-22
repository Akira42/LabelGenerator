<script>
  import PanelLabel from '../lib/Editor.svelte';
  import SmallLabels from '../lib/SmallLabels.svelte';

  let tab = $state('panel');
</script>

<nav class="tabs">
  <button class:active={tab === 'panel'} onclick={() => (tab = 'panel')}>
    Etiqueta do painel
  </button>
  <button class:active={tab === 'small'} onclick={() => (tab = 'small')}>
    Etiquetas pequenas (5 × 15×50 mm)
  </button>
</nav>

<!-- both stay mounted so nothing is lost when switching tabs -->
<div hidden={tab !== 'panel'}><PanelLabel /></div>
<div hidden={tab !== 'small'}><SmallLabels active={tab === 'small'} /></div>

<style>
  .tabs { display: flex; gap: 0.5rem; padding: 1rem 1.5rem 0; }
  .tabs button { padding: 0.5rem 1rem; }
  .tabs .active { background: #222; color: #fff; }
</style>