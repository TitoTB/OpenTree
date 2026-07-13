import type { TreeProject } from "../domain/types";

export const demoProject: TreeProject = {
  id: "demo-open-tree",
  name: "Familia Rivera Demo",
  locale: "es",
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-05T00:00:00.000Z",
  people: [
    {
      id: "elena",
      givenName: "Elena",
      familyName: "Santos",
      gender: "female",
      birthDate: "1934",
      birthPlace: "Valencia",
      deathDate: "2019",
      notes: "Guardaba cartas, recetas y fotos familiares en una caja azul.",
      events: []
    },
    {
      id: "manuel",
      givenName: "Manuel",
      familyName: "Rivera",
      gender: "male",
      birthDate: "1931",
      birthPlace: "Cuenca",
      deathDate: "2008",
      notes: "Carpintero. Su taller fue el primer lugar donde se reunía la familia los domingos.",
      events: []
    },
    {
      id: "lucia",
      givenName: "Lucia",
      familyName: "Rivera Santos",
      gender: "female",
      birthDate: "1962",
      birthPlace: "Madrid",
      notes: "Profesora de historia. Empezó a entrevistar a sus tíos para reconstruir la memoria familiar.",
      events: []
    },
    {
      id: "andres",
      givenName: "Andres",
      familyName: "Molina",
      gender: "male",
      birthDate: "1960",
      birthPlace: "Toledo",
      notes: "Aficionado a digitalizar fotos antiguas.",
      events: []
    },
    {
      id: "clara",
      givenName: "Clara",
      familyName: "Molina Rivera",
      gender: "female",
      birthDate: "1988",
      birthPlace: "Madrid",
      notes: "Quiere preparar un libro familiar para la siguiente reunión.",
      events: []
    },
    {
      id: "tomas",
      givenName: "Tomas",
      familyName: "Molina Rivera",
      gender: "male",
      birthDate: "1992",
      birthPlace: "Madrid",
      notes: "Está investigando archivos públicos y hemerotecas.",
      events: []
    }
  ],
  relationships: [
    { id: "rel-1", kind: "spouse", fromPersonId: "elena", toPersonId: "manuel", startDate: "1958" },
    { id: "rel-2", kind: "parent_child", fromPersonId: "elena", toPersonId: "lucia" },
    { id: "rel-3", kind: "parent_child", fromPersonId: "manuel", toPersonId: "lucia" },
    { id: "rel-4", kind: "spouse", fromPersonId: "lucia", toPersonId: "andres", startDate: "1986" },
    { id: "rel-5", kind: "parent_child", fromPersonId: "lucia", toPersonId: "clara" },
    { id: "rel-6", kind: "parent_child", fromPersonId: "andres", toPersonId: "clara" },
    { id: "rel-7", kind: "parent_child", fromPersonId: "lucia", toPersonId: "tomas" },
    { id: "rel-8", kind: "parent_child", fromPersonId: "andres", toPersonId: "tomas" }
  ]
};
