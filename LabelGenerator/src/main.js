import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import '@fontsource/roboto/400.css'
import '@fontsource/roboto/500.css'
import '@fontsource/roboto/700.css'

const app = mount(App, {
  target: document.getElementById('app'),
})

export default app
