import React from "react";
import {renderToString} from "react-dom/server";

function TestComponent() {
  return (
    <p>Hello World!</p>
  )
}

export function serverRenderReact() {
  return renderToString(<TestComponent />);
}