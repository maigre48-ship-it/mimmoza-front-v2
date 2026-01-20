
import { createBrowserRouter } from "react-router-dom";

import HomePage from "../pages/HomePage";

// Layouts
import ParticulierLayout from "../spaces/particulier/ParticulierLayout";
import MarchandLayout from "../spaces/marchand/MarchandLayout";
import PromoteurLayout from "../spaces/promoteur/PromoteurLayout";
import BanqueLayout from "../spaces/banque/BanqueLayout";
import AssuranceLayout from "../spaces/assurance/AssuranceLayout";

// Home pages (per space)
import ParticulierHomePage from "../spaces/particulier/pages/ParticulierHomePage";
import MarchandHomePage from "../spaces/marchand/pages/MarchandHomePage";
import PromoteurHomePage from "../spaces/promoteur/pages/PromoteurHomePage";
import BanqueHomePage from "../spaces/banque/pages/BanqueHomePage";
import AssuranceHomePage from "../spaces/assurance/pages/AssuranceHomePage";

// Shared page (currently stored in Particulier space)
import EstimationPage from "../spaces/particulier/pages/Estimation";

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

