export default defineBackground(() => {
  console.log('Office Hub background ready', { id: browser.runtime.id });
});
