import { implement } from "@olve/pipelines";
import { deployFiguresBeta } from "../pipeline";
import { deployFigures } from "./lib/figures";

export default implement(deployFiguresBeta, (input, ctx) => deployFigures(ctx, input, "apps-beta"));
