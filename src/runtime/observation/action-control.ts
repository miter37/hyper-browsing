/** Mechanical affordances only. A test ID or a container's descendant text is not an action. */
export function isActionControl(e:{tag:string;role?:string;href?:string;interaction?:{custom?:boolean}}):boolean{
 return ['input','button','select','textarea','label','summary'].includes(e.tag)
  ||e.tag==='a'&&!!e.href
  ||!!e.role&&!/^(generic|none|presentation|img|heading|dialog|alertdialog|menu|menubar|listbox|tablist|radiogroup|tree|region|main|banner|contentinfo|navigation|complementary|group|list|listitem|article|document|figure|table|rowgroup|row|cell|status|form|search|separator|toolbar|tabpanel|log|marquee|timer|feed|application|directory|definition|term)$/.test(e.role)
  ||e.interaction?.custom===true;
}
