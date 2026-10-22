import { implement } from "@olve/pipelines";
import { deployFiguresProd } from "../pipeline";
import { deployFigures } from "./lib/figures";

export default implement(deployFiguresProd, (input, ctx) => deployFigures(ctx, input, "apps"));
