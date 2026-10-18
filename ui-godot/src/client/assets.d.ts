/** The Godot logo is embedded in the plugin client bundle as a data URL. */
declare module '*.svg' {
  const url: string
  export default url
}
