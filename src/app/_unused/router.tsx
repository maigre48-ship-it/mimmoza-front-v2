import { createBrowserRouter } from "react-router-dom";

import HomePage from "../pages/HomePage";

// Layouts
import AssuranceLayout from "../spaces/assurance/AssuranceLayout";
import BanqueLayout from "../spaces/banque/BanqueLayout";
import MarchandLayout from "../spaces/marchand/MarchandLayout";
import ParticulierLayout from "../spaces/particulier/ParticulierLayout";
import PromoteurLayout from "../spaces/promoteur/PromoteurLayout";

// Home pages (per space)
import AssuranceHomePage from "../spaces/assurance/pages/AssuranceHomePage";
import BanqueHomePage from "../spaces/banque/pages/BanqueHomePage";
import MarchandHomePage from "../spaces/marchand/pages/MarchandHomePage";
import ParticulierHomePage from "../spaces/particulier/pages/ParticulierHomePage";
import PromoteurHomePage from "../spaces/promoteur/pages/PromoteurHomePage";

// Shared page (currently stored in Particulier space)
import EstimationPage from "../spaces/particulier/pages/Estimation";

// ✅ AJOUT : Implantation 2D Promoteur
import Implantation2DPage from "../spaces/promoteur/Implantation2DPage";

export const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },

  {
    path: "/particulier",
    element: <ParticulierLayout />,
    children: [
      { index: true, element: <ParticulierHomePage /> },
      { path: "estimation", element: <EstimationPage /> },
    ],
  },
  {
    path: "/marchand-de-bien",
    element: <MarchandLayout />,
    children: [
      { index: true, element: <MarchandHomePage /> },
      { path: "estimation", element: <EstimationPage /> },
    ],
  },
  {
    path: "/promoteur",
    element: <PromoteurLayout />,
    children: [
      { index: true, element: <PromoteurHomePage /> },
      { path: "estimation", element: <EstimationPage /> },

      // ✅ NOUVELLE ROUTE
      { path: "implantation-2d", element: <Implantation2DPage /> },
    ],
  },
  {
    path: "/banque",
    element: <BanqueLayout />,
    children: [
      { index: true, element: <BanqueHomePage /> },
      { path: "estimation", element: <EstimationPage /> },
    ],
  },
  {
    path: "/assurance",
    element: <AssuranceLayout />,
    children: [
      { index: true, element: <AssuranceHomePage /> },
      { path: "estimation", element: <EstimationPage /> },
    ],
  },
]);
