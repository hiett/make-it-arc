import {createUtilities} from "@kaito-http/core";

export const {router, getContext} = createUtilities(async (req, res) => {
  return {
    req,
  }
});